import { createContext, useContext } from "react";
export const ProjectMediaContext = createContext<{
  projectId: string;
  getProjectId: () => string;
  getDocument?: () => any;
  onImported: () => void;
  onAnalyzeImported?: (files: any[]) => Promise<any> | void;
  prepareImport: () => Promise<void>;
  recognition?: { document: any; jobs: any[]; submitting: any[] };
}>({
  projectId: "",
  getProjectId: () => "",
  onImported: () => {},
  prepareImport: async () => {},
});
export const useProjectMedia = () => useContext(ProjectMediaContext);
