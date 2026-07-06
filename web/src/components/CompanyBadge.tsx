import { companyInitials, companyAccent } from "../lib/companyBadge";

export default function CompanyBadge({ company }: { company: string }) {
  return (
    <span className="company-badge" style={{ color: companyAccent(company) }} aria-hidden="true">
      {companyInitials(company)}
    </span>
  );
}
