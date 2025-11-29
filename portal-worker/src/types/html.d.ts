/**
 * HTML Module Type Declarations
 * 
 * TypeScript declarations for importing .html files as modules
 */

declare module '*.html' {
  const content: string;
  export default content;
}