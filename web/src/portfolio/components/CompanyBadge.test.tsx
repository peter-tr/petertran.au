import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CompanyBadge from "./CompanyBadge";

describe("CompanyBadge", () => {
  it("renders a real logo image for a known company", () => {
    const { container } = render(<CompanyBadge company="Commonwealth Bank of Australia" />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/logos/commonwealth-bank.svg");
    expect(img).not.toHaveAttribute("style");
  });

  it("inverts the logo for companies flagged with invert", () => {
    const { container } = render(<CompanyBadge company="Services Australia" />);

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/logos/services-australia.png");
    expect(img?.style.filter).toBe("invert(1)");
  });

  it("renders the Simple Icons brand glyph for Boeing Australia", () => {
    const { container } = render(<CompanyBadge company="Boeing Australia" />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to an initials badge for an unrecognized company", () => {
    const { container, getByText } = render(<CompanyBadge company="Some Random Startup" />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(getByText("SRS")).toBeInTheDocument();
  });
});
