const TOKEN_PATTERN =
  /(#[^\n]*)|("(?:[^"\\]|\\.)*")|(\$[A-Za-z_]\w*)|\b(query|mutation|subscription|fragment|on)\b|([A-Za-z_]\w*)|(\.\.\.|[{}()[\]:,!])/g;

interface Token {
  text: string;
  className?: string;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(source))) {
    if (match.index > lastIndex) {
      tokens.push({ text: source.slice(lastIndex, match.index) });
    }

    const [full, comment, string, variable, keyword, name, punct] = match;
    let className: string | undefined;
    if (comment) className = "gql-comment";
    else if (string) className = "gql-string";
    else if (variable) className = "gql-variable";
    else if (keyword) className = "gql-keyword";
    else if (name) className = "gql-name";
    else if (punct) className = "gql-punct";
    tokens.push({ text: full, className });
    lastIndex = match.index + full.length;
  }
  if (lastIndex < source.length) tokens.push({ text: source.slice(lastIndex) });

  return tokens;
}

export default function GraphQLCode({ code }: { code: string }) {
  return (
    <pre className="op-query">
      {tokenize(code).map((token, i) =>
        token.className ? (
          <span key={i} className={token.className}>
            {token.text}
          </span>
        ) : (
          token.text
        )
      )}
    </pre>
  );
}
