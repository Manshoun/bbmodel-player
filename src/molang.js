// small molang evaluator for keyframe expressions like "math.sin(query.anim_time * 360) * 10"
// unknown queries/variables are 0, trig functions use degrees

const cache = new Map();

/**
 * @param {string|number} expr
 * @param {object} ctx { anim_time, life_time, variables }
 */
export function evalMolang(expr, ctx = {}) {
  if (typeof expr === 'number') return expr;
  let fn = cache.get(expr);
  if (!fn) {
    try {
      fn = compile(expr);
    } catch {
      fn = () => 0;
    }
    cache.set(expr, fn);
  }
  const v = fn(ctx);
  return Number.isFinite(v) ? v : 0;
}

const DEG = Math.PI / 180;
const MATH = {
  sin: (a) => Math.sin(a * DEG),
  cos: (a) => Math.cos(a * DEG),
  asin: (a) => Math.asin(a) / DEG,
  acos: (a) => Math.acos(a) / DEG,
  atan: (a) => Math.atan(a) / DEG,
  atan2: (a, b) => Math.atan2(a, b) / DEG,
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  ln: Math.log,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  min: Math.min,
  max: Math.max,
  mod: (a, b) => a % b,
  clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
  lerprotate: (a, b, t) => {
    const d = ((((b - a) % 360) + 540) % 360) - 180;
    return a + d * t;
  },
  sign: Math.sign,
  hermite_blend: (t) => 3 * t * t - 2 * t * t * t,
  random: (lo = 0, hi = 1) => lo + Math.random() * (hi - lo),
  random_integer: (lo = 0, hi = 1) => Math.floor(lo + Math.random() * (hi - lo + 1)),
  die_roll: (n, lo, hi) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += lo + Math.random() * (hi - lo);
    return s;
  },
};
const CONST = { pi: Math.PI };

function tokenize(src) {
  const re = /\s*(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+|[A-Za-z_][\w.]*|==|!=|<=|>=|&&|\|\||\?\?|[-+*/%(),?:<>!])/gy;
  const out = [];
  let m;
  re.lastIndex = 0;
  const s = src.replace(/;\s*$/, '');
  while (re.lastIndex < s.length && (m = re.exec(s))) out.push(m[1]);
  if (re.lastIndex < s.trimEnd().length) throw new Error('Molang: cannot parse ' + src);
  return out;
}

// recursive descent parser, compiles to a closure
// precedence: ternary, ??, ||, &&, compare, + -, * / %, unary
function compile(src) {
  const t = tokenize(src.toLowerCase());
  let i = 0;
  const peek = () => t[i];
  const eat = (x) => {
    if (t[i] !== x) throw new Error(`Molang: expected ${x}`);
    i++;
  };

  function ternary() {
    const c = or();
    if (peek() === '?') {
      i++;
      const a = ternary();
      if (peek() === ':') {
        i++;
        const b = ternary();
        return (ctx) => (c(ctx) ? a(ctx) : b(ctx));
      }
      return (ctx) => (c(ctx) ? a(ctx) : 0);
    }
    if (peek() === '??') {
      i++;
      const b = ternary();
      return (ctx) => c(ctx) ?? b(ctx);
    }
    return c;
  }
  function or() {
    let l = and();
    while (peek() === '||') {
      i++;
      const a = l, b = and();
      l = (ctx) => (a(ctx) || b(ctx) ? 1 : 0);
    }
    return l;
  }
  function and() {
    let l = compare();
    while (peek() === '&&') {
      i++;
      const a = l, b = compare();
      l = (ctx) => (a(ctx) && b(ctx) ? 1 : 0);
    }
    return l;
  }
  function compare() {
    let l = add();
    while (['<', '>', '<=', '>=', '==', '!='].includes(peek())) {
      const op = t[i++];
      const a = l, b = add();
      l = {
        '<': (ctx) => +(a(ctx) < b(ctx)),
        '>': (ctx) => +(a(ctx) > b(ctx)),
        '<=': (ctx) => +(a(ctx) <= b(ctx)),
        '>=': (ctx) => +(a(ctx) >= b(ctx)),
        '==': (ctx) => +(a(ctx) === b(ctx)),
        '!=': (ctx) => +(a(ctx) !== b(ctx)),
      }[op];
    }
    return l;
  }
  function add() {
    let l = mul();
    while (peek() === '+' || peek() === '-') {
      const op = t[i++];
      const a = l, b = mul();
      l = op === '+' ? (ctx) => a(ctx) + b(ctx) : (ctx) => a(ctx) - b(ctx);
    }
    return l;
  }
  function mul() {
    let l = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = t[i++];
      const a = l, b = unary();
      l = op === '*' ? (ctx) => a(ctx) * b(ctx) : op === '/' ? (ctx) => a(ctx) / b(ctx) : (ctx) => a(ctx) % b(ctx);
    }
    return l;
  }
  function unary() {
    if (peek() === '-') {
      i++;
      const a = unary();
      return (ctx) => -a(ctx);
    }
    if (peek() === '+') {
      i++;
      return unary();
    }
    if (peek() === '!') {
      i++;
      const a = unary();
      return (ctx) => (a(ctx) ? 0 : 1);
    }
    return atom();
  }
  function atom() {
    const tok = t[i++];
    if (tok === undefined) throw new Error('Molang: unexpected end');
    if (tok === '(') {
      const e = ternary();
      eat(')');
      return e;
    }
    if (/^[\d.]/.test(tok)) {
      const v = parseFloat(tok);
      return () => v;
    }
    // identifiers: math.fn(...), q./query.x, v./variable.x, this, true/false
    if (tok.startsWith('math.')) {
      const name = tok.slice(5);
      if (peek() === '(') {
        i++;
        const args = [];
        if (peek() !== ')') {
          args.push(ternary());
          while (peek() === ',') {
            i++;
            args.push(ternary());
          }
        }
        eat(')');
        const f = MATH[name] || (() => 0);
        return (ctx) => f(...args.map((a) => a(ctx)));
      }
      const c = CONST[name] ?? 0;
      return () => c;
    }
    if (tok === 'true') return () => 1;
    if (tok === 'false' || tok === 'this') return () => 0;
    const [scope, ...rest] = tok.split('.');
    const key = rest.join('.');
    if (scope === 'q' || scope === 'query') {
      if (peek() === '(') {   // query functions with arguments are not supported, swallow them
        let depth = 0;
        do {
          if (t[i] === '(') depth++;
          if (t[i] === ')') depth--;
          i++;
        } while (depth > 0 && i < t.length);
      }
      return (ctx) => (key === 'anim_time' ? ctx.anim_time || 0 : key === 'life_time' ? ctx.life_time || 0 : ctx.queries?.[key] ?? 0);
    }
    if (scope === 'v' || scope === 'variable' || scope === 't' || scope === 'temp' || scope === 'c' || scope === 'context') {
      return (ctx) => ctx.variables?.[key] ?? 0;
    }
    return () => 0;
  }

  const e = ternary();
  if (i < t.length) throw new Error('Molang: trailing tokens in ' + src);
  return e;
}
