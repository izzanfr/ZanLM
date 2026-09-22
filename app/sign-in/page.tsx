import { redirect } from "next/navigation";
import { authConfig, hasSession } from "@/lib/auth/server";
import { Logo } from "@/components/logo";
import { SignInForm } from "@/components/sign-in-form";
import { en } from "@/lib/i18n/en";
export default async function SignIn(){
  if(await hasSession())redirect("/workspace");
  const configured=!!authConfig();
  return <main id="main" className="shell sign-in-page"><section className="sign-in-art" aria-label={en.login.artwork}><Logo markOnly/><h2>{en.login.artwork}</h2><p>{en.footer.credit}</p></section><section className="sign-in-panel">{configured?<><p className="eyebrow">{en.brand}</p><h1>{en.login.title}</h1><p className="muted">{en.login.description}</p><SignInForm/></>:<><p className="eyebrow">{en.brand}</p><h1>{en.login.setupTitle}</h1><p className="muted setup-copy">{en.login.setupBody}</p><p className="setup-hint">{en.login.setupHint}</p></>}</section></main>;
}
