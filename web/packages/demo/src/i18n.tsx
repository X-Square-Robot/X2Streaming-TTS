import { createContext, useContext } from "react";
export type Locale = "en" | "zh";
export const LanguageContext = createContext<Locale>("en");
export function useText() {
  const language = useContext(LanguageContext);
  return (english: string, chinese: string) =>
    language === "zh" ? chinese : english;
}
