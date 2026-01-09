import { create } from "zustand";

export type ElementStyles = {
  backgroundColor: string;
  color: string;
  borderRadiusPx: number;
};

export type ElementData = {
  id: string;
  kind: "button";
  label: string;
  styles: ElementStyles;
};

type EditorState = {
  elements: Record<string, ElementData>;
  selectedElementId: string | null;
};

type EditorActions = {
  updateElementStyles: (id: string, styles: Partial<ElementStyles>) => void;
  selectElement: (id: string) => void;
  deselectElement: () => void;
};

type EditorStore = EditorState & EditorActions;

const DEFAULT_BUTTON: ElementData = {
  id: "button-1",
  kind: "button",
  label: "Hello Sandpack",
  styles: {
    backgroundColor: "#111111",
    color: "#ffffff",
    borderRadiusPx: 10,
  },
};

export const useEditorStore = create<EditorStore>((set) => ({
  elements: {
    [DEFAULT_BUTTON.id]: DEFAULT_BUTTON,
  },
  selectedElementId: null,

  updateElementStyles: (id, styles) =>
    set((state) => {
      const element = state.elements[id];
      if (!element) return state;
      return {
        elements: {
          ...state.elements,
          [id]: {
            ...element,
            styles: { ...element.styles, ...styles },
          },
        },
      };
    }),

  selectElement: (id) =>
    set((state) => {
      if (!state.elements[id]) return state;
      return { selectedElementId: id };
    }),

  deselectElement: () => set({ selectedElementId: null }),
}));

export function useSelectedElement(): ElementData | null {
  return useEditorStore((state) =>
    state.selectedElementId ? state.elements[state.selectedElementId] : null
  );
}
