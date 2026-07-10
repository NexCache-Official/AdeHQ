import type { AmbientContext } from "@/lib/ai/ambient-context";

type InstantAnswerKind =
  | "date"
  | "time"
  | "date_time"
  | "day"
  | "days_until"
  | "arithmetic"
  | "unit_conversion"
  | "room_people"
  | "open_tasks"
  | "topic_context";

export type InstantAnswerInput = {
  message: string;
  ambient: AmbientContext;
  employeeName?: string;
  roomName?: string;
  topicTitle?: string;
  topicDescription?: string | null;
  topicSummary?: string | null;
  roomEmployees?: { id: string; name: string; role: string }[];
  humanParticipants?: { id: string; name: string }[];
  openTasks?: { id: string; title: string; status: string; priority: string }[];
};

export type InstantAnswerResult = {
  reply: string;
  kind: InstantAnswerKind;
  confidence: number;
  fact: string;
};

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "^" }
  | { type: "paren"; value: "(" | ")" };

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const DATE_QUESTION =
  /\b(?:what(?:'s|s| is) (?:the )?(?:date|day)|today(?:'s)? date|date today|what day is it|which day is it)\b/i;
const TIME_QUESTION =
  /\b(?:what(?:'s|s| is) (?:the )?time|time (?:is it|now)|current time|local time)\b/i;
const DAYS_UNTIL =
  /\b(?:how many days|days)\s+(?:are there\s+)?(?:until|till|to)\s+([a-z]+\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{1,2}-\d{1,2})\??$/i;
const ROOM_PEOPLE =
  /\b(?:who(?:'s| is) (?:in|on) (?:this|the) room|who(?:'s| is) here|who is in this chat|room members|participants)\b/i;
const OPEN_TASKS =
  /\b(?:what(?:'s| is| are) (?:open|pending)|show|list|any)\s+(?:the\s+)?(?:open\s+)?tasks\b|\bwhat tasks are open\b/i;
const TOPIC_CONTEXT =
  /\b(?:what(?:'s| is) this topic about|summari[sz]e this topic|what are we working on|topic summary)\b/i;

const UNIT_ALIASES: Record<string, string> = {
  c: "celsius",
  celsius: "celsius",
  fahrenheit: "fahrenheit",
  f: "fahrenheit",
  kg: "kilogram",
  kilogram: "kilogram",
  kilograms: "kilogram",
  lb: "pound",
  lbs: "pound",
  pound: "pound",
  pounds: "pound",
  km: "kilometer",
  kilometer: "kilometer",
  kilometers: "kilometer",
  mile: "mile",
  miles: "mile",
  mi: "mile",
  m: "meter",
  meter: "meter",
  meters: "meter",
  ft: "foot",
  foot: "foot",
  feet: "foot",
};

const UNIT_LABELS: Record<string, string> = {
  celsius: "°C",
  fahrenheit: "°F",
  kilogram: "kg",
  pound: "lb",
  kilometer: "km",
  mile: "mi",
  meter: "m",
  foot: "ft",
};

export function looksLikeInstantAnswer(message: string): boolean {
  const text = message.trim();
  return Boolean(
    DATE_QUESTION.test(text) ||
      TIME_QUESTION.test(text) ||
      DAYS_UNTIL.test(text) ||
      ROOM_PEOPLE.test(text) ||
      OPEN_TASKS.test(text) ||
      TOPIC_CONTEXT.test(text) ||
      parseUnitConversion(text) ||
      parseArithmeticExpression(text),
  );
}

function localDateParts(ambient: AmbientContext): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: ambient.timezone,
  }).formatToParts(new Date(ambient.nowIso));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function localMidnightUtc(ambient: AmbientContext): Date {
  const parts = localDateParts(ambient);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function parseTargetDate(raw: string, ambient: AmbientContext): Date | null {
  const text = raw.trim().replace(/\./g, "");
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  const match = text.match(/^([a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  const current = localDateParts(ambient);
  let year = match[3] ? Number(match[3]) : current.year;
  let target = new Date(Date.UTC(year, month, Number(match[2])));
  const today = localMidnightUtc(ambient);
  if (!match[3] && target < today) {
    year += 1;
    target = new Date(Date.UTC(year, month, Number(match[2])));
  }
  return target;
}

function daysUntil(message: string, ambient: AmbientContext): InstantAnswerResult | null {
  const match = message.trim().match(DAYS_UNTIL);
  if (!match) return null;
  const target = parseTargetDate(match[1], ambient);
  if (!target || Number.isNaN(target.getTime())) return null;
  const today = localMidnightUtc(ambient);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const formatted = new Intl.DateTimeFormat(ambient.locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(target);
  const suffix = days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days away`;
  return {
    reply: `${formatted} is ${suffix}.`,
    kind: "days_until",
    confidence: 0.98,
    fact: `${days} days until ${formatted}`,
  };
}

function tokenizeExpression(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  let previous: Token | undefined;

  while (i < expression.length) {
    const char = expression[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    const unaryMinus =
      char === "-" &&
      (!previous ||
        previous.type === "operator" ||
        (previous.type === "paren" && previous.value === "("));
    if (/\d|\./.test(char) || unaryMinus) {
      const match = expression.slice(i).match(unaryMinus ? /^-\d+(?:\.\d+)?/ : /^\d+(?:\.\d+)?/);
      if (!match) return null;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) return null;
      const token: Token = { type: "number", value };
      tokens.push(token);
      previous = token;
      i += match[0].length;
      continue;
    }

    if ("+-*/^".includes(char)) {
      const token: Token = {
        type: "operator",
        value: char as "+" | "-" | "*" | "/" | "^",
      };
      tokens.push(token);
      previous = token;
      i += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      const token: Token = { type: "paren", value: char };
      tokens.push(token);
      previous = token;
      i += 1;
      continue;
    }

    return null;
  }

  return tokens.length ? tokens : null;
}

function precedence(operator: Token & { type: "operator" }): number {
  if (operator.value === "^") return 3;
  if (operator.value === "*" || operator.value === "/") return 2;
  return 1;
}

function evaluateExpression(expression: string): number | null {
  const tokens = tokenizeExpression(expression);
  if (!tokens) return null;
  const output: Token[] = [];
  const operators: Token[] = [];

  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
    } else if (token.type === "operator") {
      while (operators.length) {
        const top = operators[operators.length - 1];
        if (
          top.type !== "operator" ||
          precedence(top) < precedence(token) ||
          (token.value === "^" && precedence(top) === precedence(token))
        ) {
          break;
        }
        output.push(operators.pop()!);
      }
      operators.push(token);
    } else if (token.value === "(") {
      operators.push(token);
    } else {
      while (operators.length && operators[operators.length - 1].type !== "paren") {
        output.push(operators.pop()!);
      }
      if (!operators.length) return null;
      operators.pop();
    }
  }
  while (operators.length) {
    const token = operators.pop()!;
    if (token.type === "paren") return null;
    output.push(token);
  }

  const stack: number[] = [];
  for (const token of output) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }
    if (token.type !== "operator" || stack.length < 2) return null;
    const b = stack.pop()!;
    const a = stack.pop()!;
    const value =
      token.value === "+"
        ? a + b
        : token.value === "-"
          ? a - b
          : token.value === "*"
            ? a * b
            : token.value === "/"
              ? b === 0
                ? Number.NaN
                : a / b
              : a ** b;
    if (!Number.isFinite(value)) return null;
    stack.push(value);
  }

  return stack.length === 1 ? stack[0] : null;
}

function parseArithmeticExpression(message: string): string | null {
  const text = message
    .trim()
    .toLowerCase()
    .replace(/^what(?:'s| is)\s+/i, "")
    .replace(/^calculate\s+/i, "")
    .replace(/\?$/i, "")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\btimes\b|\bmultiplied by\b/g, "*")
    .replace(/\bdivided by\b|\bover\b/g, "/");
  if (!/^[\d\s.+\-*/^()]+$/.test(text)) return null;
  if (!/[+\-*/^]/.test(text.replace(/^-/, ""))) return null;
  return text;
}

function arithmetic(message: string): InstantAnswerResult | null {
  const expression = parseArithmeticExpression(message);
  if (!expression) return null;
  const result = evaluateExpression(expression);
  if (result === null) return null;
  const formatted = Number.isInteger(result)
    ? String(result)
    : Number(result.toFixed(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return {
    reply: `${formatted}.`,
    kind: "arithmetic",
    confidence: 0.96,
    fact: `${expression} = ${formatted}`,
  };
}

function parseUnitConversion(message: string):
  | { value: number; fromUnit: string; toUnit: string }
  | null {
  const match = message
    .trim()
    .toLowerCase()
    .match(
      /^(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*([a-z°]+)\s+(?:to|in)\s+([a-z°]+)\??$/,
    );
  if (!match) return null;
  const fromUnit = UNIT_ALIASES[match[2].replace("°", "")];
  const toUnit = UNIT_ALIASES[match[3].replace("°", "")];
  if (!fromUnit || !toUnit) return null;
  return { value: Number(match[1]), fromUnit, toUnit };
}

function convertUnit(value: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return value;
  if (fromUnit === "celsius" && toUnit === "fahrenheit") return value * 1.8 + 32;
  if (fromUnit === "fahrenheit" && toUnit === "celsius") return (value - 32) / 1.8;

  const meters: Record<string, number> = {
    kilometer: 1000,
    mile: 1609.344,
    meter: 1,
    foot: 0.3048,
  };
  if (fromUnit in meters && toUnit in meters) {
    return (value * meters[fromUnit]) / meters[toUnit];
  }

  const kilograms: Record<string, number> = {
    kilogram: 1,
    pound: 0.45359237,
  };
  if (fromUnit in kilograms && toUnit in kilograms) {
    return (value * kilograms[fromUnit]) / kilograms[toUnit];
  }

  return null;
}

function unitConversion(message: string): InstantAnswerResult | null {
  const parsed = parseUnitConversion(message);
  if (!parsed || !Number.isFinite(parsed.value)) return null;
  const converted = convertUnit(parsed.value, parsed.fromUnit, parsed.toUnit);
  if (converted === null) return null;
  const formatted = Number(converted.toFixed(4)).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
  const fact = `${parsed.value} ${UNIT_LABELS[parsed.fromUnit]} = ${formatted} ${
    UNIT_LABELS[parsed.toUnit]
  }`;
  return {
    reply: `${fact}.`,
    kind: "unit_conversion",
    confidence: 0.96,
    fact,
  };
}

function roomPeople(input: InstantAnswerInput): InstantAnswerResult | null {
  if (!ROOM_PEOPLE.test(input.message)) return null;
  const humans = input.humanParticipants ?? [];
  const employees = input.roomEmployees ?? [];
  const names = [
    ...humans.map((person) => person.name),
    ...employees.map((employee) => `${employee.name} (${employee.role})`),
  ].filter(Boolean);
  if (!names.length) return null;
  const room = input.roomName ? ` in ${input.roomName}` : "";
  return {
    reply: `Here${room}: ${names.join(", ")}.`,
    kind: "room_people",
    confidence: 0.94,
    fact: names.join(", "),
  };
}

function openTasks(input: InstantAnswerInput): InstantAnswerResult | null {
  if (!OPEN_TASKS.test(input.message)) return null;
  const tasks = (input.openTasks ?? []).filter((task) =>
    ["open", "in_progress", "waiting_approval", "blocked"].includes(task.status),
  );
  if (!tasks.length) {
    return {
      reply: "I don't see any open tasks in this topic right now.",
      kind: "open_tasks",
      confidence: 0.9,
      fact: "No open tasks",
    };
  }
  const list = tasks
    .slice(0, 6)
    .map((task) => `- ${task.title} (${task.status.replace(/_/g, " ")}, ${task.priority})`)
    .join("\n");
  const more = tasks.length > 6 ? `\n- ${tasks.length - 6} more…` : "";
  return {
    reply: `Open tasks:\n${list}${more}`,
    kind: "open_tasks",
    confidence: 0.92,
    fact: `${tasks.length} open tasks`,
  };
}

function topicContext(input: InstantAnswerInput): InstantAnswerResult | null {
  if (!TOPIC_CONTEXT.test(input.message)) return null;
  const summary = input.topicSummary?.trim();
  const description = input.topicDescription?.trim();
  const title = input.topicTitle?.trim();
  const text = summary || description || title;
  if (!text) return null;
  return {
    reply: title && text !== title ? `${title}: ${text}` : text,
    kind: "topic_context",
    confidence: summary ? 0.9 : 0.82,
    fact: text,
  };
}

export function resolveInstantAnswer(input: InstantAnswerInput): InstantAnswerResult | null {
  const text = input.message.trim();
  if (!text) return null;

  const relative = daysUntil(text, input.ambient);
  if (relative) return relative;

  const wantsDate = DATE_QUESTION.test(text);
  const wantsTime = TIME_QUESTION.test(text);
  if (wantsDate && wantsTime) {
    return {
      reply: `${input.ambient.dateHuman}, ${input.ambient.timeHuman} (${input.ambient.timezone}).`,
      kind: "date_time",
      confidence: 0.99,
      fact: `${input.ambient.dateHuman} ${input.ambient.timeHuman}`,
    };
  }
  if (wantsDate) {
    const kind = /\bday\b/i.test(text) && !/\bdate\b/i.test(text) ? "day" : "date";
    return {
      reply:
        kind === "day"
          ? `It's ${input.ambient.dateHuman.split(",")[0]}.`
          : `It's ${input.ambient.dateHuman}.`,
      kind,
      confidence: 0.99,
      fact: input.ambient.dateHuman,
    };
  }
  if (wantsTime) {
    return {
      reply: `It's ${input.ambient.timeHuman} (${input.ambient.timezone}).`,
      kind: "time",
      confidence: 0.99,
      fact: `${input.ambient.timeHuman} ${input.ambient.timezone}`,
    };
  }

  return (
    arithmetic(text) ??
    unitConversion(text) ??
    roomPeople(input) ??
    openTasks(input) ??
    topicContext(input)
  );
}
