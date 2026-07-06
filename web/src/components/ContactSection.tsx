import { useState, type FormEvent } from "react";
import Section from "./Section";
import { runQuery, SEND_MESSAGE_MUTATION, type SendMessageResult } from "../lib/graphql";

type Status = "idle" | "sending" | "sent" | "error";

export default function ContactSection() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    try {
      const result = await runQuery<SendMessageResult>(SEND_MESSAGE_MUTATION, {
        input: { name, email, message },
      });
      if (result.sendMessage.success) {
        setStatus("sent");
        setConfirmation(result.sendMessage.message);
        setName("");
        setEmail("");
        setMessage("");
      } else {
        throw new Error("Message wasn't accepted -- please try again.");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Section id="contact" typeName="Mutation">
      <p className="project-desc" style={{ marginBottom: "1.2rem" }}>
        This form calls <code>sendMessage(input: ContactInput!)</code> on the same API used above -- no
        separate backend, just the mutation this page is documenting.
      </p>

      {status === "sent" ? (
        <p className="status-line">// {confirmation}</p>
      ) : (
        <form className="contact-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="form-label" htmlFor="contact-name">
              Name
            </label>
            <input
              id="contact-name"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="contact-email">
              Email
            </label>
            <input
              id="contact-email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="contact-message">
              Message
            </label>
            <textarea
              id="contact-message"
              className="form-input form-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              maxLength={5000}
              rows={5}
            />
          </div>

          {error && <p className="status-line">// {error}</p>}

          <button className="run-btn" type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send message"}
          </button>
        </form>
      )}
    </Section>
  );
}
