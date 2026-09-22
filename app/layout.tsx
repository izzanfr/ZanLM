import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { en } from "@/lib/i18n/en";
import "./globals.css";
export const metadata:Metadata={title:en.meta.title,description:en.meta.description,icons:{icon:"/icon.svg"}};
export default async function RootLayout({children}:{children:React.ReactNode}){
  const theme=(await cookies()).get("zanlm_theme")?.value === "dark" ? "dark" : "light";
  return <html lang="en" data-theme={theme} data-scroll-behavior="smooth"><body><Header initialTheme={theme}/>{children}<Footer/></body></html>;
}
