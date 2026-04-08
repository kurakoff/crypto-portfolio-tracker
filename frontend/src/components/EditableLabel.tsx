import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
  className?: string;
}

export default function EditableLabel({ value, placeholder = 'Add label...', onSave, className = '' }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onSave(trimmed);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') cancel();
        }}
        placeholder={placeholder}
        className={`rounded border border-blue-300 bg-white px-1.5 py-0.5 text-sm font-medium text-gray-900 outline-none focus:ring-1 focus:ring-blue-400 ${className}`}
      />
    );
  }

  return (
    <span
      className={`group inline-flex cursor-pointer items-center gap-1 ${className}`}
      onDoubleClick={startEdit}
    >
      <span className={`text-sm font-medium ${value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
        {value || placeholder}
      </span>
      <button
        onClick={e => { e.stopPropagation(); startEdit(); }}
        className="text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-gray-500"
        title="Edit label"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
    </span>
  );
}
