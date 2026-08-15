"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { StarterKit } from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/react";

import { cn } from "@/lib/cn";

function MenuButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-sm font-medium text-secondary transition-colors",
        active && "bg-accent-soft text-accent-strong",
        !active && "hover:bg-surface-muted hover:text-foreground",
        disabled && "opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface p-1.5" role="toolbar" aria-label="Formatting">
      <MenuButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="font-bold">B</span>
      </MenuButton>
      <MenuButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic">I</span>
      </MenuButton>
      <MenuButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <span className="line-through">S</span>
      </MenuButton>
      <MenuButton
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <span className="font-mono text-xs">&lt;/&gt;</span>
      </MenuButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <MenuButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span className="text-sm font-semibold">H<span className="align-super text-[10px]">3</span></span>
      </MenuButton>
      <MenuButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" strokeWidth="3" />
        </svg>
      </MenuButton>
      <MenuButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M3 5l1.5-1v5M3 19c1 0 1.3.5 1.5.8 0 0-.2.7-1.5.7M3.5 13c.6 0 1.3-.5 1.3-1.2 0-.9-1.3-1-1.3-1.8 0-.7.8-1 1.5-1" strokeWidth="1.5" />
        </svg>
      </MenuButton>
      <MenuButton
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
          <path d="M7.5 6C5 6 3 8 3 10.5S5 15 7.5 15c.3 0 .6 0 .9-.1C8 17 6.5 18.5 5 19h1.7c2.9 0 6.3-2.4 6.3-6.2 0-1.2-.3-3-2.8-3.7C11 7.6 10 6 7.5 6Z" />
          <path d="M18.5 6C16 6 14 8 14 10.5S16 15 18.5 15c.3 0 .6 0 .9-.1C19 17 17.5 18.5 16 19h1.7c2.9 0 6.3-2.4 6.3-6.2 0-1.2-.3-3-2.8-3.7C22 7.6 21 6 18.5 6Z" transform="translate(-3 0)" />
        </svg>
      </MenuButton>
      <MenuButton
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
          <path d="m8 9-3 3 3 3M16 9l3 3-3 3" />
          <rect x="3" y="4" width="18" height="16" rx="2" />
        </svg>
      </MenuButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <MenuButton
        label="Add link"
        active={editor.isActive("link")}
        onClick={setLink}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </MenuButton>
      <MenuButton
        label="Horizontal rule"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
          <path d="M3 12h18" />
        </svg>
      </MenuButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <MenuButton
        label="Undo"
        disabled={!editor.can().chain().focus().undo().run()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
        </svg>
      </MenuButton>
      <MenuButton
        label="Redo"
        disabled={!editor.can().chain().focus().redo().run()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H10a6 6 0 0 0 0 12h3" />
        </svg>
      </MenuButton>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Condition, reason for selling, what's included...",
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]">
      {editor && <Toolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className="rte-content max-h-96 min-h-40 cursor-text overflow-y-auto px-4 py-3 text-sm leading-6 text-foreground [&_.ProseMirror]:min-h-24 [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}