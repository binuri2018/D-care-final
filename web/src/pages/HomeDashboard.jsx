import React from "react";
import { Link } from "react-router-dom";

const MODULES = [
  {
    to: "/reminders",
    title: "Reminders",
    blurb: "Outdoor/indoor mode, Firebase sync, and dispatch to the mobile client.",
    icon: "🔔",
  },
  {
    to: "/analytics",
    title: "Analytics",
    blurb: "Lightweight charts and trends over reminder activity.",
    icon: "📊",
  },
  {
    to: "/memory",
    title: "Memory",
    blurb: "Face and memory workflows tied to the research backend.",
    icon: "🧠",
  },
  {
    to: "/screening",
    title: "Cognitive screening",
    blurb: "Structured tasks, MMSE-style flows, and session results.",
    icon: "🧪",
  },
  {
    to: "/dementia-action",
    title: "Dementia action",
    blurb: "Live session tooling for the dementia action subsystem.",
    icon: "🛡️",
  },
  {
    to: "/dg",
    title: "D-care Guardian",
    blurb: "Guardian and patient portals: alerts, chat, reports, and pairing.",
    icon: "👪",
  },
];

export default function HomeDashboard() {
  return (
    <div className="home-dashboard">
      <header className="home-dashboard__hero">
        <div className="home-dashboard__hero-text">
          <p className="home-dashboard__eyebrow">Clinical research workspace</p>
          <h1 className="home-dashboard__title">D-care</h1>
          <p className="home-dashboard__lead">
            A single hub for reminders, cognitive screening, memory tasks, and
            guardian workflows—aligned with the Memory Aid stack and mobile
            companion.
          </p>
        </div>
        <div className="home-dashboard__hero-visual">
          <img
            src={`${process.env.PUBLIC_URL}/home-hero.svg`}
            alt=""
            className="home-dashboard__hero-img"
            width={640}
            height={360}
            decoding="async"
          />
        </div>
      </header>

      <section className="home-dashboard__modules" aria-label="Platform areas">
        <h2 className="home-dashboard__section-title">Areas</h2>
        <p className="home-dashboard__section-sub">
          Short map of the system—pick a module from the sidebar anytime.
        </p>
        <ul className="home-dashboard__grid">
          {MODULES.map((m) => (
            <li key={m.to}>
              <Link to={m.to} className="home-dashboard__card">
                <span className="home-dashboard__card-icon" aria-hidden>
                  {m.icon}
                </span>
                <div>
                  <h3 className="home-dashboard__card-title">{m.title}</h3>
                  <p className="home-dashboard__card-blurb">{m.blurb}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
