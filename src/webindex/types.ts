export interface IndexedDoc {
  id: string;
  url: string;
  title: string;
  snippet: string;
  text: string;
  addedAt: string;
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  score: number;
}
