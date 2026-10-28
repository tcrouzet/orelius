import { EditorState, Prec, StateField, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export function editorLock(notePath: (state: EditorState) => string | undefined, isLocked: (path: string) => boolean): Extension {
  const locked = (state: EditorState) => {
    const path = notePath(state);
    return path !== undefined && isLocked(path);
  };
  const field = StateField.define<boolean>({ create: locked, update: (_value, transaction) => locked(transaction.state) });
  return [
    field,
    Prec.highest(EditorState.readOnly.computeN([field], state => state.field(field) ? [true] : [])),
    Prec.highest(EditorView.editable.computeN([field], state => state.field(field) ? [false] : [])),
    EditorView.contentAttributes.computeN([field], state => state.field(field)
      ? [{ "aria-readonly": "true", title: "Codex travaille sur cette note — lecture seule temporaire." }] : []),
    EditorState.transactionFilter.of(transaction => {
      const event = transaction.annotation(Transaction.userEvent) ?? "";
      return locked(transaction.startState) && transaction.docChanged && /^(input|delete|move|undo|redo)(\.|$)/.test(event)
        ? [] : transaction;
    }),
  ];
}
