// Kept deliberately small - classifying in tokenize() below instead of in the
// pattern itself. Keywords get no branch of their own (the name branch already
// matches them in full, so "on" inside "onClick" can't be mis-split), `$vars`
// share that same name branch via the optional `\$`, and "..." is its own
// branch rather than an alternation nested inside the punctuation one.
// Identical tokens out, far less regex to reason about.
const TOKEN_PATTERN = /(#[^\n]*)|("(?:[^"\\]|\\.)*")|(\$?[A-Za-z_]\w*)|(\.\.\.)|([{}()[\]:,!])/g;

interface Token {
  text: string;
  className?: string;
  // Offset of this token in the source it was tokenized from - unique per
  // token, so it works as a stable React key without falling back to the
  // array index.
  start: number;
}

const INDENT = "  ";

// The stored/router-planned query text is minified to one line (see
// operation-stats-plugin.ts and Apollo Router's subgraph fetch queries), so
// this reformats it for display. Deliberately a small bracket-depth-based
// pretty-printer rather than pulling in the `graphql` package's parse/print -
// that package isn't otherwise part of the runtime web bundle, and this
// component is loaded on every homepage visit (SystemStatsSection isn't lazy),
// so this stays a plain-text reformat rather than a real AST round-trip. Not
// spec-complete (e.g. block strings, directives), but every query this app
// actually samples is a simple selection set.
const KEYWORDS = new Set(["query", "mutation", "subscription", "fragment", "on"]);

// Untyped "gap" tokens from tokenize() (e.g. a numeric literal like "1",
// which nothing in TOKEN_PATTERN matches) can carry incidental surrounding
// whitespace - trim those down to their real text so spacing in formatQuery
// is only ever added once, deliberately, rather than inherited from the input.
function significantTokens(source: string): string[] {
  const significant: string[] = [];
  for (const token of tokenize(source)) {
    const text = token.className ? token.text : token.text.trim();
    if (text !== "") significant.push(text);
  }

  return significant;
}

// A new line means a fresh selection: right after "{" opens a real selection
// set, or right after a sibling field/fragment-spread that just ended
// (anything other than "{"/":"/an operation keyword, since those precede a
// name that's part of the SAME construct).
function startsNewLine(prev: string | null, inline: boolean): boolean {
  if (inline || prev === null) return false;
  if (prev === "{") return true;

  return prev !== ":" && !KEYWORDS.has(prev);
}

export function formatQuery(source: string): string {
  let out = "";
  let indent = 0;
  let parenDepth = 0;
  let objDepth = 0;
  let prev: string | null = null;

  // Appends with a single leading space, except right after "(" (opening an
  // argument/variable list), the very start of the query, or "{" opening an
  // inline object-literal argument value - all three attach their next token
  // directly with no space.
  function append(text: string, newline = false): void {
    if (newline) {
      out += `\n${INDENT.repeat(indent)}${text}`;
    } else {
      const noSpaceBefore =
        prev === null || prev === "(" || (prev === "{" && (parenDepth > 0 || objDepth > 0));
      out += noSpaceBefore ? text : ` ${text}`;
    }
    prev = text;
  }

  // Punctuation that always hugs whatever precedes it with no space: ")"/"]"
  // closing an inline construct, "," and ":" separators, "!" non-null
  // markers, and "}" closing an inline object literal (as opposed to a real
  // selection set, which gets its own newline+dedent below instead).
  function hug(text: string): void {
    out += text;
    prev = text;
  }

  for (const text of significantTokens(source)) {
    const inline = parenDepth > 0 || objDepth > 0;

    switch (text) {
      case "}":
        if (inline) {
          objDepth = Math.max(0, objDepth - 1);
          hug(text);
        } else {
          indent = Math.max(0, indent - 1);
          append(text, true);
        }
        break;
      case "{":
        append(text);
        if (inline) objDepth++;
        else indent++;
        break;
      case "(":
        hug(text);
        parenDepth++;
        break;
      case ")":
        parenDepth = Math.max(0, parenDepth - 1);
        hug(text);
        break;
      case "]":
      case ",":
      case ":":
      case "!":
        hug(text);
        break;
      case "[":
        append(text);
        break;
      default:
        append(text, startsNewLine(prev, inline));
    }
  }

  return out;
}

// The name branch of TOKEN_PATTERN covers three different things - "$id"
// variables, operation keywords, and plain field/type names - so they're told
// apart here rather than by giving each its own alternation branch.
function nameClassName(name: string): string {
  if (name.startsWith("$")) return "gql-variable";

  return KEYWORDS.has(name) ? "gql-keyword" : "gql-name";
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(source))) {
    if (match.index > lastIndex) {
      tokens.push({ text: source.slice(lastIndex, match.index), start: lastIndex });
    }

    const [full, comment, string, name, spread, punct] = match;
    let className: string | undefined;
    if (comment) className = "gql-comment";
    else if (string) className = "gql-string";
    else if (name) className = nameClassName(name);
    else if (spread || punct) className = "gql-punct";
    tokens.push({ text: full, className, start: match.index });
    lastIndex = match.index + full.length;
  }
  if (lastIndex < source.length) tokens.push({ text: source.slice(lastIndex), start: lastIndex });

  return tokens;
}

export default function GraphQLCode({ code }: Readonly<{ code: string }>) {
  return (
    <pre className="op-query">
      {tokenize(formatQuery(code)).map((token) =>
        token.className ? (
          <span key={token.start} className={token.className}>
            {token.text}
          </span>
        ) : (
          token.text
        )
      )}
    </pre>
  );
}
