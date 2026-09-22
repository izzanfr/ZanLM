import { Plus } from "lucide-react";
import { en } from "@/lib/i18n/en";
export function Limitations(){return <details className="limitations"><summary><span>{en.limits.title}</span><Plus size={20} aria-hidden="true"/></summary><div className="limitations-body"><p>{en.limits.intro}</p><ul>{en.limits.items.map(item=><li key={item}>{item}</li>)}</ul><p className="privacy-note">{en.limits.privacy}</p></div></details>;}
