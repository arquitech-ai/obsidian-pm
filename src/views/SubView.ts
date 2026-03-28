export interface SubView {
  render(): void;
  handleKeyDown?(e: KeyboardEvent): void;
}
