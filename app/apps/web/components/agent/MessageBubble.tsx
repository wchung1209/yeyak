import { clsx } from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatTextMessage } from "./types";

/**
 * Chat bubble. User messages stay plain text. Assistant messages are
 * rendered through react-markdown with GFM (tables, autolinks, strikethrough)
 * because the agent emits markdown for emphasis and structure. Raw HTML
 * is NOT rendered (react-markdown's default), so this is XSS-safe.
 *
 * Style overrides aim for "tight chat formatting" — no balloon margins,
 * compact lists, table scrolls horizontally on narrow viewports.
 */
export function MessageBubble({ message }: { message: ChatTextMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={clsx("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-ink text-cream rounded-br-sm whitespace-pre-wrap"
            : "bg-white text-ink rounded-bl-sm border border-ink/5",
        )}
      >
        {isUser ? (
          message.text
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="mb-2 last:mb-0">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold">{children}</strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => (
                <ul className="my-2 ml-5 list-disc space-y-0.5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="my-2 ml-5 list-decimal space-y-0.5">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-snug">{children}</li>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brass underline-offset-2 hover:underline"
                >
                  {children}
                </a>
              ),
              code: ({ children }) => (
                <code className="rounded bg-ink/5 px-1 py-0.5 font-mono text-xs">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="my-2 overflow-x-auto rounded-md bg-ink/5 p-2 font-mono text-xs">
                  {children}
                </pre>
              ),
              table: ({ children }) => (
                <div className="my-2 overflow-x-auto">
                  <table className="border-collapse text-xs">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-ink/10 px-2 py-1 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-ink/10 px-2 py-1 align-top">
                  {children}
                </td>
              ),
              h1: ({ children }) => (
                <h3 className="mb-1 mt-2 font-serif text-base">{children}</h3>
              ),
              h2: ({ children }) => (
                <h3 className="mb-1 mt-2 font-serif text-base">{children}</h3>
              ),
              h3: ({ children }) => (
                <h3 className="mb-1 mt-2 font-serif text-base">{children}</h3>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-2 border-l-2 border-ink/10 pl-3 text-muted">
                  {children}
                </blockquote>
              ),
            }}
          >
            {message.text}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
