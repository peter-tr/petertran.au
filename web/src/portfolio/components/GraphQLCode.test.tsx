import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import GraphQLCode, { formatQuery } from "./GraphQLCode";

afterEach(cleanup);

describe("formatQuery", () => {
  it("breaks a minified selection set onto multiple indented lines", () => {
    const source =
      "query Footer__portfolio__0 { person { email } meta { awsCostUsd anthropicCostUsd totalCostUsd } }";

    expect(formatQuery(source)).toBe(
      [
        "query Footer__portfolio__0 {",
        "  person {",
        "    email",
        "  }",
        "  meta {",
        "    awsCostUsd",
        "    anthropicCostUsd",
        "    totalCostUsd",
        "  }",
        "}",
      ].join("\n")
    );
  });

  it("keeps arguments and variable definitions inline", () => {
    const source = "query Foo($id: ID!) { person(id: $id, active: true) { name } }";

    expect(formatQuery(source)).toBe(
      ["query Foo($id: ID!) {", "  person(id: $id, active: true) {", "    name", "  }", "}"].join("\n")
    );
  });

  it("keeps an inline object-literal argument on one line", () => {
    const source = "query Foo { field(input: {a: 1, b: 2}) }";

    expect(formatQuery(source)).toBe(["query Foo {", "  field(input: {a: 1, b: 2})", "}"].join("\n"));
  });

  it("keeps a field alias inline with its field name", () => {
    const source = "query Foo { renamed: person { name } }";

    expect(formatQuery(source)).toBe(
      ["query Foo {", "  renamed: person {", "    name", "  }", "}"].join("\n")
    );
  });

  it("is idempotent on already-formatted input", () => {
    const already = ["query Foo {", "  person {", "    name", "  }", "}"].join("\n");

    expect(formatQuery(already)).toBe(already);
  });
});

describe("GraphQLCode", () => {
  it("renders the reformatted, multi-line query text", () => {
    const { container } = render(<GraphQLCode code="query Foo { person { email } }" />);

    const pre = container.querySelector("pre.op-query");
    expect(pre?.textContent).toBe(["query Foo {", "  person {", "    email", "  }", "}"].join("\n"));
  });
});
