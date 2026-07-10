import { SiBoeing } from "react-icons/si";
import { companyInitials, companyAccent } from "../lib/companyBadge";

// Real logos where we have one - falls back to a colored initials badge for
// everything else (see companyBadge.ts). Boeing's is a Simple Icons brand
// glyph; the other two are real assets fetched from the companies' own
// sites (see web/public/logos), since neither has a Simple Icons entry.
const LOGO_IMAGES: Record<string, { src: string; invert?: boolean }> = {
  "Commonwealth Bank of Australia": { src: "/logos/commonwealth-bank.svg" },
  "Services Australia": { src: "/logos/services-australia.png", invert: true },
  "University of Queensland": { src: "/logos/uq.png" },
  "Australian Defence Force": { src: "/logos/adf.png" },
};

export default function CompanyBadge({ company }: { company: string }) {
  const logo = LOGO_IMAGES[company];
  if (logo) {
    return (
      <span className="company-badge company-badge-logo" aria-hidden="true">
        <img src={logo.src} alt="" style={logo.invert ? { filter: "invert(1)" } : undefined} />
      </span>
    );
  }

  if (company === "Boeing Australia") {
    return (
      <span className="company-badge company-badge-logo" style={{ color: "var(--paper)" }} aria-hidden="true">
        <SiBoeing size="1.15rem" />
      </span>
    );
  }

  return (
    <span className="company-badge" style={{ color: companyAccent(company) }} aria-hidden="true">
      {companyInitials(company)}
    </span>
  );
}
