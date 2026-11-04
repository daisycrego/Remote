// Meal planning with Claude: web search + web fetch find current prices at the
// user's shops, then Claude submits the finished plan through a strict tool.
//
// Runs entirely in the browser with the user's own API key. The SDK bundle is
// loaded lazily, only when a plan is requested.

export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 (best results)', input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (lower cost)', input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
};
export const DEFAULT_MODEL = 'claude-opus-5-5';

// "claude-opus-5-5" -> "Claude Opus 5.5" (also for fallback models not listed above).
export function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(String(id));
  if (!m) return String(id || 'Claude');
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
const SEARCH_PRICE = 0.01; // $10 per 1,000 searches; web fetch has no per-use fee
const MAX_REQUESTS = 8; // pause_turn continuations + one nudge + one retry

export class PlannerError extends Error {
  constructor(message, { kind = 'error', cause } = {}) {
    super(message, { cause });
    this.kind = kind;
  }
}

// ---------------------------------------------------------------- prompt

const SYSTEM_PROMPT = `You plan home-cooked meals for a household on a grocery budget, using current prices from the specific shops they name. You work inside a personal web app that shows your result as a shopping list and recipes.

How to work:
- Search the web for recent prices at the user's shops for the ingredients you plan to use. Good sources are the shop's own website or online store, its weekly ad or circular, and delivery listings (such as Instacart) for that store and area. Prefer listings from the last few weeks. If a shop's website is given, you can fetch it.
- Choose meals that fit the budget, the number of people, their preferences and what they already have. Share ingredients across meals and plan leftovers where it makes sense, to cut cost and waste. Base meals on recipes you find (include the URL) or write simple ones yourself.
- Price the shopping list in units the shop sells (a 2 lb pack, a dozen eggs), not recipe amounts. Put each item at whichever of the user's shops is the better buy.
- Be honest about prices. Mark a price "listed" only when you saw that price for that shop, and give the URL where you saw it. Otherwise mark it "estimated" and base it on comparable listings. Never make up URLs.
- Keep the total at or under budget. If that isn't possible, get as close as you can and explain in the notes.
- Assume basic staples (salt, pepper, cooking oil) are on hand unless told otherwise, and list what you assumed.
- Searches cost the user money. Cover several ingredients per search where you can, and stop searching once you can price the list well.

When you're done, call submit_meal_plan once with the complete plan. Don't write the plan out as text.`;

function userPrompt(request, settings) {
  const shops = request.shops
    .map((s, i) => `${i + 1}. ${s.name}${s.details ? ` (${s.details})` : ''}`)
    .join('\n');
  const place = [settings.city, settings.region, settings.country].filter(Boolean).join(', ');
  const details = [
    `Budget: ${request.budget} ${settings.currency} in total`,
    `Days: ${request.days}`,
    `Meals each day: ${request.meals.join(', ')}`,
    `People eating each meal: ${request.servings}`,
    place && `My area: ${place}`,
    `Today's date: ${request.date}`,
  ];
  const parts = ['Plan my meals and shopping.', details.filter(Boolean).join('\n'), `Shops to use:\n${shops}`];
  if (request.preferences) parts.push(`Preferences: ${request.preferences}`);
  if (request.pantry) parts.push(`Already in my kitchen: ${request.pantry}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------- tools

const PLAN_TOOL = {
  name: 'submit_meal_plan',
  description:
    'Submit the finished meal plan and priced shopping list. Call this exactly once, at the end, after researching prices.',
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'currency', 'meals', 'shopping_list', 'pantry_assumed', 'notes'],
    properties: {
      summary: { type: 'string', description: 'Two or three sentences on the plan and how it fits the budget.' },
      currency: { type: 'string', description: 'ISO 4217 currency code, e.g. USD.' },
      meals: {
        type: 'array',
        description: 'One entry for every requested meal on every day, in order.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['day', 'meal', 'title', 'leftovers_of', 'servings', 'time_minutes', 'recipe_url', 'ingredients', 'steps'],
          properties: {
            day: { type: 'integer', description: 'Day number, starting at 1.' },
            meal: { type: 'string', description: 'Breakfast, Lunch or Dinner.' },
            title: { type: 'string' },
            leftovers_of: {
              type: 'string',
              description: "If this meal is leftovers of an earlier meal, that meal's title. Otherwise an empty string.",
            },
            servings: { type: 'integer' },
            time_minutes: { type: 'integer', description: 'Total time to make it. 0 for leftovers.' },
            recipe_url: { type: 'string', description: 'URL of a recipe you found, or an empty string if you wrote it.' },
            ingredients: {
              type: 'array',
              items: { type: 'string' },
              description: 'With amounts, e.g. "2 cups cooked rice". Empty for leftovers.',
            },
            steps: { type: 'array', items: { type: 'string' }, description: 'Short steps. Empty for leftovers.' },
          },
        },
      },
      shopping_list: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['shop', 'item', 'quantity', 'estimated_price', 'price_basis', 'source_url', 'for_meals'],
          properties: {
            shop: { type: 'string', description: 'Exactly one of the shop names the user gave.' },
            item: { type: 'string' },
            quantity: { type: 'string', description: 'What to buy in store units, e.g. "2 lb pack" or "1 dozen".' },
            estimated_price: { type: 'number', description: 'Price for this whole line.' },
            price_basis: {
              type: 'string',
              enum: ['listed', 'estimated'],
              description: '"listed" only if you saw this price for this shop; otherwise "estimated".',
            },
            source_url: { type: 'string', description: 'Where you saw the price, or an empty string.' },
            for_meals: { type: 'array', items: { type: 'string' }, description: 'Titles of the meals that use it.' },
          },
        },
      },
      pantry_assumed: { type: 'array', items: { type: 'string' }, description: 'Staples you assumed are on hand.' },
      notes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Caveats and tips: how recent prices are, substitutions, anything over budget.',
      },
    },
  },
};

function serverTools(settings) {
  const search = { type: 'web_search_20260209', name: 'web_search', max_uses: settings.maxSearches };
  const location = {
    type: 'approximate',
    ...(settings.city && { city: settings.city }),
    ...(settings.region && { region: settings.region }),
    ...(/^[A-Z]{2}$/.test(settings.country) && { country: settings.country }),
    ...(settings.timezone && { timezone: settings.timezone }),
  };
  if (Object.keys(location).length > 1) search.user_location = location;
  return [search, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 10, max_content_tokens: 20000 }];
}

// ---------------------------------------------------------------- run

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {object} o.settings   { model, city, region, country, timezone, currency, maxSearches }
 * @param {object} o.request    { budget, days, meals[], servings, shops[{name, details}], preferences, pantry, date }
 * @param {(e: object) => void} o.onProgress
 * @param {AbortSignal} o.signal
 */
export async function runPlanner({ apiKey, settings, request, onProgress = () => {}, signal }) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('./vendor/anthropic-sdk.mjs'));
  } catch (err) {
    throw new PlannerError("Couldn't load the Claude SDK. Check your connection and reload the page.", { cause: err });
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const model = MODELS[settings.model] ? settings.model : DEFAULT_MODEL;
  const tools = [...serverTools(settings), PLAN_TOOL];
  const messages = [{ role: 'user', content: userPrompt(request, settings) }];
  const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, searches: 0, fetches: 0 };
  const sources = new Map();
  let nudged = false;
  let retried = false;

  try {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'high' },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM_PROMPT,
          tools,
          messages,
        },
        { signal },
      );
      watchStream(stream, onProgress, sources);

      let message;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        // With eager input streaming, a tool input that isn't valid JSON rejects here.
        // Retry that turn once; real API errors go to the outer handler.
        if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIUserAbortError || signal?.aborted || retried) throw err;
        retried = true;
        onProgress({ kind: 'status', text: 'Retrying the last step…' });
        continue;
      }
      addUsage(usage, message);

      if (message.stop_reason === 'refusal') {
        throw new PlannerError("Claude declined to make this plan. Try rewording your preferences.", { kind: 'refusal' });
      }

      const call = message.content.find((b) => b.type === 'tool_use' && b.name === PLAN_TOOL.name);
      if (call) {
        if (message.stop_reason === 'max_tokens') {
          throw new PlannerError('The plan was too long to finish. Try fewer days or meals.', { kind: 'truncated' });
        }
        const plan = validatePlan(call.input, request, settings);
        if (plan) {
          return { plan, usage, cost: estimateCost(usage, model), model: message.model || model, sources: [...sources.values()] };
        }
        if (retried) throw new PlannerError("Claude's plan came back incomplete. Please try again.", { kind: 'invalid' });
        retried = true;
        messages.push(
          { role: 'assistant', content: echoContent(message.content) },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: call.id,
                is_error: true,
                content: 'The plan was missing meals or shopping list items. Call submit_meal_plan again with the complete plan.',
              },
            ],
          },
        );
        continue;
      }

      if (message.stop_reason === 'pause_turn') {
        // Long server-side tool loop: send the turn back unchanged and the API resumes it.
        messages.push({ role: 'assistant', content: echoContent(message.content) });
        continue;
      }
      if (message.stop_reason === 'max_tokens') {
        throw new PlannerError('Claude ran out of room before finishing. Try fewer days or meals.', { kind: 'truncated' });
      }
      if (nudged) break;
      nudged = true;
      onProgress({ kind: 'status', text: 'Asking Claude to finish the plan…' });
      messages.push(
        { role: 'assistant', content: echoContent(message.content) },
        { role: 'user', content: 'Please call submit_meal_plan now with the complete plan, using what you found.' },
      );
    }
    throw new PlannerError("Claude didn't finish a plan. Please try again.", { kind: 'no-plan' });
  } catch (err) {
    throw friendlyError(err, Anthropic, signal);
  }
}

function friendlyError(err, Anthropic, signal) {
  if (err instanceof PlannerError) return err;
  if (err instanceof Anthropic.APIUserAbortError || signal?.aborted) {
    return new PlannerError('Planning was cancelled.', { kind: 'cancelled', cause: err });
  }
  const detail = err?.error?.error?.message || err?.message || '';
  if (err instanceof Anthropic.AuthenticationError) {
    return new PlannerError('Anthropic rejected your API key. Check it in meal planner settings.', { kind: 'auth', cause: err });
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new PlannerError(`Your API key isn't allowed to do this. ${detail}`, { kind: 'permission', cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new PlannerError('Anthropic is rate-limiting your key. Wait a minute and try again.', { kind: 'rate', cause: err });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new PlannerError(`Anthropic couldn't run this request: ${detail}`, { kind: 'request', cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new PlannerError("Couldn't reach Anthropic. Check your connection and try again.", { kind: 'network', cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new PlannerError(`Anthropic's API had a problem (${err.status ?? 'unknown'}). Try again in a moment.`, { kind: 'server', cause: err });
  }
  return new PlannerError(`Something went wrong: ${detail || 'unknown error'}`, { cause: err });
}

// After a mid-turn model fallback, some earlier blocks must be dropped before the
// turn is sent back (thinking and client tool calls from before the switch, and
// server tool calls that never got a result). Everything else goes back unchanged.
export function echoContent(content) {
  let last = -1;
  content.forEach((b, i) => {
    if (b.type === 'fallback') last = i;
  });
  if (last < 0) return content;
  const answered = new Set(content.map((b) => b.tool_use_id).filter(Boolean));
  return content.filter((b, i) => {
    if (i >= last) return true;
    if (['thinking', 'redacted_thinking', 'connector_text', 'tool_use'].includes(b.type)) return false;
    if (b.type === 'server_tool_use') return answered.has(b.id);
    return true;
  });
}

function watchStream(stream, onProgress, sources) {
  let planChars = 0;
  stream.on('streamEvent', (event, snapshot) => {
    if (event.type !== 'content_block_delta' || event.delta.type !== 'input_json_delta') return;
    const block = snapshot.content[event.index];
    if (block?.type === 'tool_use' && block.name === PLAN_TOOL.name) {
      planChars += event.delta.partial_json.length;
      onProgress({ kind: 'writing', chars: planChars });
    }
  });
  stream.on('contentBlock', (block) => {
    switch (block.type) {
      case 'server_tool_use':
        if (block.name === 'web_search' && block.input?.query) onProgress({ kind: 'search', text: block.input.query });
        if (block.name === 'web_fetch' && block.input?.url) onProgress({ kind: 'fetch', text: block.input.url });
        break;
      case 'web_search_tool_result':
        if (Array.isArray(block.content)) {
          for (const r of block.content) if (r.url) sources.set(r.url, { url: r.url, title: r.title || r.url });
        }
        break;
      case 'web_fetch_tool_result':
        if (block.content?.url) sources.set(block.content.url, { url: block.content.url, title: block.content.url });
        break;
      case 'fallback':
        onProgress({ kind: 'status', text: `Continuing with ${block.to?.model ?? 'another model'}…` });
        break;
      case 'tool_use':
        if (block.name === PLAN_TOOL.name) onProgress({ kind: 'status', text: 'Checking the plan…' });
        break;
      default:
    }
  });
}

function addUsage(total, message) {
  const u = message.usage ?? {};
  total.input += u.input_tokens ?? 0;
  total.cacheWrite += u.cache_creation_input_tokens ?? 0;
  total.cacheRead += u.cache_read_input_tokens ?? 0;
  total.output += u.output_tokens ?? 0;
  total.searches += u.server_tool_use?.web_search_requests ?? 0;
  total.fetches += u.server_tool_use?.web_fetch_requests ?? 0;
}

// Approximate cost in USD at list prices for the requested model.
export function estimateCost(usage, model) {
  const p = MODELS[model] ?? MODELS[DEFAULT_MODEL];
  const tokens =
    usage.input * p.input + usage.cacheWrite * p.cacheWrite + usage.cacheRead * p.cacheRead + usage.output * p.output;
  return tokens / 1e6 + usage.searches * SEARCH_PRICE;
}

// ---------------------------------------------------------------- validation

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.parseFloat(v));
const strings = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const httpUrl = (v) => {
  try {
    const u = new URL(text(v));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
};

// Checks and cleans the tool input. The tool is strict, but with eager input
// streaming the API doesn't re-validate it, so nothing here is taken on trust.
export function validatePlan(input, request, settings) {
  if (!input || typeof input !== 'object') return null;
  const shopNames = request.shops.map((s) => s.name);
  const matchShop = (name) => shopNames.find((s) => s.toLowerCase() === text(name).toLowerCase()) || text(name) || 'Other';

  const meals = (Array.isArray(input.meals) ? input.meals : [])
    .filter((m) => m && text(m.title))
    .map((m) => ({
      day: Math.max(1, Math.round(num(m.day)) || 1),
      meal: text(m.meal) || 'Meal',
      title: text(m.title),
      leftoversOf: text(m.leftovers_of),
      servings: Math.max(0, Math.round(num(m.servings)) || 0),
      timeMinutes: Math.max(0, Math.round(num(m.time_minutes)) || 0),
      recipeUrl: httpUrl(m.recipe_url),
      ingredients: strings(m.ingredients),
      steps: strings(m.steps),
    }));

  const shoppingList = (Array.isArray(input.shopping_list) ? input.shopping_list : [])
    .filter((it) => it && text(it.item))
    .map((it) => {
      const sourceUrl = httpUrl(it.source_url);
      const price = num(it.estimated_price);
      return {
        shop: matchShop(it.shop),
        item: text(it.item),
        quantity: text(it.quantity),
        price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0,
        // A "listed" price needs a source; without one it's an estimate.
        basis: it.price_basis === 'listed' && sourceUrl ? 'listed' : 'estimated',
        sourceUrl,
        forMeals: strings(it.for_meals),
      };
    });

  if (!meals.length || !shoppingList.length) return null;
  const total = Math.round(shoppingList.reduce((sum, it) => sum + it.price, 0) * 100) / 100;
  return {
    summary: text(input.summary),
    currency: /^[A-Z]{3}$/.test(text(input.currency)) ? text(input.currency) : settings.currency,
    total,
    meals,
    shoppingList,
    pantryAssumed: strings(input.pantry_assumed),
    notes: strings(input.notes),
  };
}
