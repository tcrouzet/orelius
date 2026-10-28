import { StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { revisionMarks, type RevisionHighlight } from "./revision.ts";

const refresh = StateEffect.define<null>();

class DeletionMark extends WidgetType {
  constructor(private readonly text: string) { super(); }
  eq(other: DeletionMark): boolean { return this.text === other.text; }
  toDOM(view: EditorView): HTMLElement {
    const marker = view.dom.ownerDocument.adoptNode(createSpan({ cls: "orelius-revision-deletion" }));
    marker.textContent = "▏";
    marker.title = `Texte supprimé : ${this.text}`;
    marker.setAttribute("aria-label", marker.title);
    return marker;
  }
}

export function revisionHighlights(snapshots: () => Record<string, RevisionHighlight>) {
  const editors = new Set<EditorView>();
  const extension = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    private path: string | undefined;
    private snapshot: RevisionHighlight | undefined;
    constructor(private readonly view: EditorView) { editors.add(view); this.build(view); }
    update(update: ViewUpdate): void {
      const path = update.state.field(editorInfoField, false)?.file?.path;
      if (update.docChanged || path !== this.path || snapshots()[path ?? ""] !== this.snapshot
        || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refresh)))) this.build(update.view);
    }
    private build(view: EditorView): void {
      this.path = view.state.field(editorInfoField, false)?.file?.path;
      this.snapshot = this.path ? snapshots()[this.path] : undefined;
      const marks = this.snapshot ? revisionMarks(this.snapshot, view.state.doc.toString()) : [];
      this.decorations = Decoration.set(marks.map(mark => mark.from < mark.to
        ? Decoration.mark({ class: "orelius-revision-change", attributes: { title: "Texte modifié par Codex" } }).range(mark.from, mark.to)
        : Decoration.widget({ widget: new DeletionMark(mark.removed), side: 1 }).range(mark.from)), true);
    }
    destroy(): void { editors.delete(this.view); }
  }, { decorations: value => value.decorations });
  return { extension, refresh: () => { for (const editor of editors) editor.dispatch({ effects: refresh.of(null) }); } };
}
