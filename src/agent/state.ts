export type SourceType = "internal" | "web";

export interface Evidence {
  id: string;
  source: SourceType;
  title: string;
  snippet: string;
  score: number;
  docPath?: string;
  docName?: string;
  sectionPath?: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface AgentState {
  userQuery: string;
  planBrief: string;
  activeRetrievalQuery: string;
  retrievalQueriesTried: string[];
  localRetrievalPass: number;
  retryLocal: boolean;
  localEvidence: Evidence[];
  webEvidence: Evidence[];
  localConfidence: number;
  shouldUseWeb: boolean;
  redactedQuery: string;
  finalAnswer: string;
}

export const initialState = (userQuery: string): AgentState => ({
  userQuery,
  planBrief: "",
  activeRetrievalQuery: userQuery,
  retrievalQueriesTried: [],
  localRetrievalPass: 0,
  retryLocal: false,
  localEvidence: [],
  webEvidence: [],
  localConfidence: 0,
  shouldUseWeb: false,
  redactedQuery: "",
  finalAnswer: ""
});
