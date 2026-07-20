import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequestsChart from "./RequestsChart";
import type { DailyCount } from "../lib/graphql";

function day(offsetFromToday: number, count: number): DailyCount {
  const d = new Date();
  d.setDate(d.getDate() + offsetFromToday);

  return { timestamp: d.toISOString(), count };
}

describe("RequestsChart", () => {
  it("renders nothing when there is no data", () => {
    const { container } = render(<RequestsChart data={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("defaults to the last-7-days range and draws one bar per day", () => {
    const data = Array.from({ length: 30 }, (_, i) => day(-(29 - i), i + 1));
    const { container } = render(<RequestsChart data={data} />);

    expect(screen.getByRole("tab", { name: "last 7 days" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "last 30 days" })).toHaveAttribute("aria-selected", "false");
    expect(container.querySelectorAll("rect.chart-bar")).toHaveLength(7);
  });

  it("switches to 30 days when that tab is clicked", async () => {
    const user = userEvent.setup();
    const data = Array.from({ length: 30 }, (_, i) => day(-(29 - i), i + 1));
    const { container } = render(<RequestsChart data={data} />);

    await user.click(screen.getByRole("tab", { name: "last 30 days" }));

    expect(screen.getByRole("tab", { name: "last 30 days" })).toHaveAttribute("aria-selected", "true");
    expect(container.querySelectorAll("rect.chart-bar")).toHaveLength(30);
  });

  it("labels the svg with the max count for the visible range", () => {
    const data = [day(-2, 3), day(-1, 8), day(0, 5)];
    render(<RequestsChart data={data} />);

    expect(screen.getByRole("img", { name: /ranging from 0 to 8/ })).toBeInTheDocument();
  });

  it("rounds the axis max up to a clean 1/2/5/10 step above the data max", () => {
    const data = [day(-1, 1), day(0, 6)];
    const { container } = render(<RequestsChart data={data} />);

    // 6 * 1.15 = 6.9 -> rounds up to the next clean step, which is 10.
    expect(container.querySelector(".chart-axis-tick")?.textContent).toBe("10");
  });
});
