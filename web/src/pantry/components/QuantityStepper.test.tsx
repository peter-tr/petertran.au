import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuantityStepper from "./QuantityStepper";

describe("QuantityStepper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the current value", () => {
    render(<QuantityStepper value={5} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(5);
  });

  it("moves the displayed number immediately on + click, before the debounce fires", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} onChange={onChange} />);

    fireEvent.click(screen.getByText("+"));

    expect(screen.getByRole("spinbutton")).toHaveValue(6);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange only after the debounce window elapses", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} onChange={onChange} />);

    fireEvent.click(screen.getByText("+"));
    vi.advanceTimersByTime(399);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledWith(6);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of clicks into a single trailing onChange call", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} onChange={onChange} />);

    fireEvent.click(screen.getByText("+"));
    vi.advanceTimersByTime(100);
    fireEvent.click(screen.getByText("+"));
    vi.advanceTimersByTime(100);
    fireEvent.click(screen.getByText("+"));

    expect(screen.getByRole("spinbutton")).toHaveValue(8);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it("does not step below min on repeated - clicks", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={1} onChange={onChange} min={0} />);

    fireEvent.click(screen.getByText("−"));
    expect(screen.getByRole("spinbutton")).toHaveValue(0);

    // The button becomes disabled once the field is already at min.
    expect(screen.getByText("−")).toBeDisabled();
  });

  it("uses a custom step size", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={100} onChange={onChange} step={100} />);

    fireEvent.click(screen.getByText("+"));
    expect(screen.getByRole("spinbutton")).toHaveValue(200);
  });

  it("resets the draft to the new value when the value prop changes from outside", () => {
    const { rerender } = render(<QuantityStepper value={5} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(5);

    rerender(<QuantityStepper value={9} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(9);
  });

  it("allows freely typing (including clearing the field) without snapping back to min", () => {
    render(<QuantityStepper value={5} onChange={() => {}} min={1} />);

    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
  });

  it("clamps to min and commits on blur", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} onChange={onChange} min={1} />);

    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);

    expect(input).toHaveValue(1);
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("commits on Enter by blurring the field", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} onChange={onChange} />);

    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("does not call onChange on blur/commit if the value didn't actually change", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} onChange={onChange} />);

    const input = screen.getByRole("spinbutton");

    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to min when the typed value is not a number", () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} onChange={onChange} min={2} />);

    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(input).toHaveValue(2);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("disables all controls when disabled prop is set", () => {
    render(<QuantityStepper value={5} onChange={() => {}} disabled />);

    expect(screen.getByText("+")).toBeDisabled();
    expect(screen.getByText("−")).toBeDisabled();
    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });

  it("flushes a still-pending debounced change on unmount", () => {
    const onChange = vi.fn();
    const { unmount } = render(<QuantityStepper value={5} onChange={onChange} />);

    fireEvent.click(screen.getByText("+"));
    expect(onChange).not.toHaveBeenCalled();

    unmount();
    expect(onChange).toHaveBeenCalledWith(6);
  });
});
