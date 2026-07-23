export type ArtifactDesignTokens = {
  key: string;
  name: string;
  colors: {
    ink: string;
    muted: string;
    accent: string;
    pale: string;
    border: string;
    background: string;
    headerFill?: string;
  };
  typography: {
    display: string;
    body: string;
    mono?: string;
  };
  document?: {
    pageMarginPt?: number;
    headingScale?: number;
  };
  presentation?: {
    accentBar?: boolean;
    footerBrand?: boolean;
  };
  spreadsheet?: {
    headerFill?: string;
    headerText?: string;
  };
};
