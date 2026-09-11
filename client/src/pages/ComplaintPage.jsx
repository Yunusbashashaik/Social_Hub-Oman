import { Link } from "react-router-dom";
import ComplaintForm from "../components/ComplaintForm.jsx";

export default function ComplaintPage({ t }) {
  return (
    <main className="complaint-page">
      <section className="complaint-section container">
        <p className="complaint-back" data-reveal>
          <Link to="/">← {t.backToHome}</Link>
        </p>
        <h1 className="complaint-page-title" data-reveal>
          {t.complaintTitle}
        </h1>
        <p className="complaint-page-lead" data-reveal style={{ "--reveal-delay": "80ms" }}>
          {t.complaintLead}
        </p>
        <div data-reveal style={{ "--reveal-delay": "140ms" }}>
          <ComplaintForm t={t} />
        </div>
      </section>
    </main>
  );
}
