import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiGet, apiPost, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { useAuthExperience } from '../components/AuthExperience'
import { PageIntro } from '../components/Common'
import { applyPageMetadata, SITE_ORIGIN } from '../../shared/page-metadata'

type Section = { id: string; title: string; paragraphs: React.ReactNode[] }
type DocumentPage = { title: string; description: string; version: string; sections: Section[] }
const EFFECTIVE_DATE = '24 October 2026'
const DRAFT = 'Draft for legal review'

const documents: Record<string, DocumentPage> = {
  '/legal/terms': {
    title: 'Terms of Service', description: 'Terms for using Joblite AHIS.', version: 'terms-v1-2026-10-24-draft', sections: [
      { id: 'operator', title: 'Operator and service', paragraphs: [<>Joblite AHIS is operated by Aidomex Group Ltd, Wakiso, Uganda. Postal address: 118472, Uganda. The service provides public job discovery, community posts, profiles, employer job publishing, and application tracking.</>] },
      { id: 'accounts', title: 'Accounts and access', paragraphs: [<>Account access uses a single-use verification code sent by email. Keep access to your email secure and provide accurate account information. You are responsible for actions taken through your signed-in account.</>, <>Public job browsing does not require an account. An account is required for account-specific features such as saving opportunities, publishing, applying to a Joblite-hosted vacancy, and managing employer listings.</>] },
      { id: 'content', title: 'Your content', paragraphs: [<>You keep rights you hold in your content. You give Joblite permission to host, reproduce, resize, display, and distribute content as needed to operate the features you choose, including public feeds and public link previews. That permission ends when content is removed, subject to backups, legal obligations, and copies already made by other people or preview services.</>, <>Do not post content you lack permission to share, confidential hiring materials, unlawful content, or sensitive personal information about another person.</>] },
      { id: 'jobs', title: 'Jobs and applications', paragraphs: [<>Joblite may display jobs posted by employers and jobs imported from identified third-party sources. Imported jobs link to the original source. Listings can become unavailable or change after Joblite last checked them.</>, <>External employers control their own sites, application processes, eligibility, hiring decisions, pay, and working conditions. Joblite does not promise that a vacancy is genuine, that an employer will respond, or that an application will succeed. A click to an external application link is not a submitted application.</>] },
      { id: 'employer', title: 'Employers and recruiters', paragraphs: [<>Employers must be authorized to represent the organization and vacancy, keep listings accurate, use applicant data only for the disclosed hiring purpose, restrict access to people involved in hiring, and retain or delete applicant materials according to applicable law and their own disclosed process.</>, <>Do not use Joblite to collect information unrelated to a role, discriminate unlawfully, misrepresent a vacancy, request prohibited fees, or reuse applicant details for unrelated marketing.</>] },
      { id: 'availability', title: 'Moderation and availability', paragraphs: [<>We may restrict or remove content or access when needed to protect people, respond to a valid legal request, address abuse, or maintain the service. Some moderation and appeal tools are not yet available in the product; removal or review requests can be submitted through the privacy and contact routes in the Legal Center.</>, <>The service and its third-party integrations may be unavailable or change. Nothing in these terms removes rights that cannot legally be waived.</>] },
      { id: 'age', title: 'Age and minors', paragraphs: [<>Joblite is designed for people aged 18 and over. Joblite does not currently provide a parent or guardian consent workflow for children. The age rule is a product safeguard, not a statement that one age threshold determines legal capacity in every country. Do not create an account if you are under 18; contact the operator through the public website if an account was created in error.</>] },
      { id: 'changes', title: 'Changes and governing rules', paragraphs: [<>We will identify the version and date of these terms. If a material change requires renewed agreement, Joblite will request it in the product before relying on the changed terms for the affected account. Mandatory local consumer and privacy protections continue to apply. These draft terms do not select a governing law or waive mandatory rights.</>] },
    ],
  },
  '/legal/privacy': {
    title: 'Privacy Notice', description: 'How Joblite AHIS handles account, job, application, and community information.', version: 'privacy-v1-2026-10-24-draft', sections: [
      { id: 'controller', title: 'Who operates Joblite', paragraphs: [<>The operator identified for Joblite AHIS is Aidomex Group Ltd, Wakiso, Uganda. Postal address: 118472, Uganda. No privacy email, telephone number, street address, or Data Protection Officer contact has been verified for publication. Signed-in users can submit an authenticated privacy request through <Link to="/legal/privacy-rights">Privacy rights</Link>.</>] },
      { id: 'data', title: 'Information the product handles', paragraphs: [<>Depending on features used, Joblite stores an email address and verification/session records; profile details you submit; public posts, comments, images and videos; saved jobs; employer organization and vacancy details; Joblite-hosted application records and immutable application snapshots; external-job tracking statuses that you choose to record; notifications; and privacy/terms preference records.</>, <>Joblite receives job records from the job sources named on each listing and may receive approximate country information from Cloudflare request metadata. Search and job-country preferences are user-selected. The product does not request GPS location. Do not include sensitive personal data unless a feature and lawful basis specifically require it.</>] },
      { id: 'purposes', title: 'Why information is used', paragraphs: [<>Information is used to provide requested account, feed, job-search, publishing, application, hiring, security, and support functions; to send authentication email; to prevent abuse and enforce rate limits; to keep operational records; and to meet legal obligations. Profile and post visibility is controlled by the feature and settings shown in the product.</>, <>Job ranking currently uses published time, search filters, and available eligibility/location fields. The product does not currently use an advertising profile or an analytics SDK.</>] },
      { id: 'public', title: 'Public content and recipients', paragraphs: [<>Public profiles, posts, comments, published employer listings, and their approved public media can be viewed and copied by other people and crawlers. Public content may be included in link previews. Deleting content removes it from Joblite’s public lookup, but cannot erase copies made by other people or external preview caches immediately.</>, <>Joblite uses Cloudflare Workers, D1, R2, and delivery services to host and secure the service. Resend is used to deliver authentication codes. Job-source providers receive server-side requests for permitted job ingestion. When you follow an external application link, the destination employer or provider receives your visit under its own terms and privacy notice. Joblite does not embed those job sites in the page.</>] },
      { id: 'international', title: 'Location and international processing', paragraphs: [<>The app is hosted on Cloudflare infrastructure and uses Resend for email; processing locations can depend on those providers’ service configurations. Job data is obtained from external providers. Joblite does not promise data residency in Uganda or another country. A selected legal region affects the displayed policy supplement only; it does not establish residence or silently alter contractual terms.</>] },
      { id: 'retention', title: 'Retention and deletion', paragraphs: [<>Authentication challenges expire after ten minutes. Session records are retained until expiry or revocation and are used to enforce sign-in. Job-source records are refreshed under provider-specific rules. Account profile, posts, application snapshots, and related records are retained while needed to operate the account and for legitimate legal, security, or record-keeping needs. Joblite has not yet published fixed retention periods for every data category; these require operational and legal review.</>, <>A deletion request is recorded for review. Some records may need to be retained where required to complete an application record, resolve a dispute, meet a legal duty, or protect service security. Any such exception and its duration should be explained when the request is handled.</>] },
      { id: 'rights', title: 'Your choices and rights', paragraphs: [<>Depending on the law that applies, you may request access, correction, deletion, export, object to certain processing, or withdraw consent. Use the authenticated <Link to="/legal/privacy-rights">privacy request form</Link>. The form verifies access through your Joblite session. If you cannot sign in, complete email verification first; Joblite has no separately verified privacy email published at this time.</>, <>Marketing is optional and is not required to use an account. Optional analytics and advertising tools are not currently installed. Essential session and security storage remains in use to provide requested account features.</>] },
      { id: 'security', title: 'Security', paragraphs: [<>Joblite uses access controls, hashed authentication challenges and session tokens, secure cookies, and server-side validation. No internet service can guarantee absolute security. If you believe an account or personal information is at risk, use the authenticated privacy request flow and contact Aidomex Group Ltd through the website.</>] },
      { id: 'children', title: 'Children', paragraphs: [<>Joblite is designed for users aged 18 and over and does not currently implement a parent or guardian consent flow. If you believe a minor’s information has been submitted, use the privacy request flow. The age position is a product safeguard and requires jurisdiction-specific review.</>] },
    ],
  },
  '/legal/cookies': {
    title: 'Cookies and Privacy Choices', description: 'The browser storage Joblite uses and how to change privacy choices.', version: 'cookies-v1-2026-10-24-draft', sections: [
      { id: 'current', title: 'What is active now', paragraphs: [<>Joblite uses an HttpOnly session cookie for sign-in. It also uses session storage to preserve an unfinished post draft and local storage for your explicit privacy-choice and legal-region preferences. The app does not currently install analytics, advertising pixels, marketing SDKs, or third-party embedded widgets. Google Fonts has been removed; the interface uses system fonts.</>] },
      { id: 'necessary', title: 'Essential storage', paragraphs: [<>The session cookie is necessary for account features you request and is Secure on HTTPS, HttpOnly, SameSite=Strict, scoped to the site, and time-limited. Rejecting optional tracking does not disable sign-in, security controls, or public browsing. Some browser settings may still prevent account features from working.</>] },
      { id: 'choices', title: 'Privacy choices', paragraphs: [<>Use the persistent “Privacy choices” control to accept or reject optional tracking, or customize the current setting. There are no optional categories active today. Your choice is saved locally and a pseudonymous preference record may be stored so Joblite can honor that choice. If optional tools are added later, they must remain blocked until a valid choice applies.</>] },
      { id: 'withdraw', title: 'Change or withdraw', paragraphs: [<>You can change or withdraw a choice at any time using “Privacy choices.” Joblite can stop future first-party optional requests and clear its own nonessential choice storage, but cannot remove data already collected by a third party. No such optional third-party tracker is currently installed.</>] },
    ],
  },
  '/legal/acceptable-use': { title: 'Acceptable Use', description: 'Rules for safe and lawful use of Joblite AHIS.', version: 'acceptable-use-v1-2026-10-24-draft', sections: [
    { id: 'prohibited', title: 'Prohibited activity', paragraphs: [<>Do not post unlawful, deceptive, threatening, discriminatory, harassing, infringing, or exploitative content; impersonate employers or candidates; distribute malware; scrape or overload the service; bypass access controls; publish private information without authority; or use Joblite to collect applicant information for unrelated purposes.</>] },
    { id: 'employers', title: 'Hiring conduct', paragraphs: [<>Employers must describe roles accurately, identify the hiring organization, avoid discriminatory criteria and misleading compensation claims, and handle candidate information only for a disclosed hiring purpose. Do not request payment from candidates unless a lawful, clearly disclosed service is involved; Joblite does not currently support payments.</>] },
    { id: 'moderation', title: 'Enforcement and reports', paragraphs: [<>Joblite may restrict or remove material to address safety, rights, legal requirements, or service integrity. The product’s public moderation/reporting workflow is not yet available. Privacy and account requests can be submitted through the Legal Center.</>] },
  ] },
  '/legal/community-guidelines': { title: 'Community Guidelines', description: 'Guidance for respectful Joblite community posts.', version: 'community-v1-2026-10-24-draft', sections: [
    { id: 'community', title: 'Share constructively', paragraphs: [<>Share work, opportunities, and professional updates honestly. Respect others’ privacy and intellectual property. Do not post another person’s CV, contact details, image, or private hiring information without permission.</>] },
    { id: 'safety', title: 'Keep opportunities trustworthy', paragraphs: [<>Identify whether a job is posted on Joblite or imported from an external source. Do not claim Joblite verified an external employer or guarantees a job. Never impersonate a recruiter, request credentials, or make unsupported promises about salary or hiring outcomes.</>] },
    { id: 'enforcement', title: 'When guidelines are breached', paragraphs: [<>Joblite may remove content or restrict accounts when needed. A reporting and appeal interface is not currently implemented; do not rely on a decorative report control. Use the website’s privacy request flow for personal-data issues.</>] },
  ] },
  '/legal/job-disclaimer': { title: 'Job Listing Disclaimer', description: 'How to interpret native and imported job listings.', version: 'job-disclaimer-v1-2026-10-24-draft', sections: [
    { id: 'sources', title: 'Where listings come from', paragraphs: [<>Joblite labels native employer listings separately from imported listings and identifies the source where available. Imported listings and links may be delayed, changed, expired, or removed by their provider.</>] },
    { id: 'external', title: 'External applications', paragraphs: [<>The employer or external job provider controls the application destination, eligibility, terms, hiring decisions, and any information collected after you leave Joblite. An external-link click is not a submitted application. Check the destination before sharing personal information.</>] },
    { id: 'no-guarantees', title: 'No employment guarantee', paragraphs: [<>Joblite does not guarantee that an employer is legitimate, a vacancy remains open, a salary will be paid, or that any application will receive a response. A salary or condition is shown only when the source supplies it.</>] },
  ] },
  '/legal/privacy-rights': { title: 'Privacy Rights and Requests', description: 'Submit and follow a privacy request for your Joblite account.', version: 'privacy-rights-v1-2026-10-24-draft', sections: [
    { id: 'rights', title: 'Rights and scope', paragraphs: [<>Depending on the law that applies, request access, correction, deletion, export, objection, or consent withdrawal. This workflow verifies the account through your active Joblite session; it does not accept an unverified email as proof of identity.</>] },
    { id: 'process', title: 'What happens next', paragraphs: [<>A request receives a timestamp and status. The current product records requests as “received”; a human operator must review and complete any action that is not available as an immediate account control. Joblite will assess identity proportionately and explain any retention exception. Applicable response deadlines depend on the region and request type; no universal deadline is promised here.</>] },
    { id: 'appeal', title: 'Regulator contact', paragraphs: [<>For Uganda, information about complaints and the Personal Data Protection Office is available at <a href="https://pdpo.go.ug/" target="_blank" rel="noreferrer">pdpo.go.ug</a>. This link does not imply Joblite is registered with the PDPO.</>] },
  ] },
  '/legal/employer-terms': { title: 'Employer and Recruiter Terms', description: 'Draft terms for organizations posting roles and handling applicants.', version: 'employer-terms-v1-2026-10-24-draft', sections: [
    { id: 'authority', title: 'Authority and listings', paragraphs: [<>You must be authorized to create and manage an organization and its vacancies. Keep company, job, compensation, location, eligibility, and application details accurate and current. Close roles that are no longer open.</>] },
    { id: 'applicants', title: 'Applicant data', paragraphs: [<>Use candidate details and immutable application snapshots only for the disclosed role and lawful hiring process. Restrict access to authorized hiring personnel, protect downloaded materials, and follow your own retention obligations. Do not add applicant data to unrelated marketing lists or pass it to another employer without authority.</>] },
    { id: 'responsibility', title: 'Hiring decisions', paragraphs: [<>Employers remain responsible for employment decisions, legal compliance, fair selection, and communication with candidates. Joblite does not make or guarantee a hiring decision. Employer verification, where shown, is not a guarantee of every vacancy or request.</>] },
    { id: 'payments', title: 'Payments', paragraphs: [<>Joblite does not currently accept employer or candidate payments. No payment, refund, or fee term is created by this draft.</>] },
  ] },
}

const regionalNotes: Record<string, string> = {
  UG: 'Uganda supplement: the Data Protection and Privacy Act, Cap. 97 and the 2021 Regulations may apply because the operator is located in Uganda and processes personal data there. The operator must confirm its PDPO registration, annual reporting, transfer safeguards, and any DPO designation obligations.',
  EEA: 'EEA supplement: GDPR applies to a controller established in the EEA, or to a controller outside it when processing relates to offering goods/services to people in the EEA or monitoring their behaviour there. Mere technical accessibility is not enough by itself. Joblite has not established that it targets EEA residents; counsel should assess actual activity before treating this supplement as applicable. EEA national ePrivacy rules may separately regulate device storage/access.',
  UK: 'UK supplement: UK GDPR territorial scope includes processing in the context of a UK establishment and certain processing by organisations outside the UK that offer services to people in the UK or monitor their behaviour there. Mere accessibility is not conclusive. Counsel should assess actual targeting and any UK representative requirement.',
  other: 'Other region: local privacy, consumer, employment, and electronic communications rules may apply based on the user, employer, and processing context. This selector does not determine legal residence or applicable law.',
  unknown: 'Unknown region: showing the common privacy-protective baseline. The approximate network-derived country is unavailable; choose a region to see a contextual note. This choice does not establish residence or legal scope.',
}

export function useLegalRegion() {
  const [region, setRegion] = useState('unknown')
  const [detected, setDetected] = useState('unknown')
  useEffect(() => {
    const selected = localStorage.getItem('joblite:legal-region')
    apiGet<{ detected_region: string }>('/legal/region').then(({ data }) => {
      const current = ['UG','EEA','UK','other'].includes(data.detected_region) ? data.detected_region : 'unknown'
      setDetected(current)
      setRegion(selected || current)
    }).catch(() => setRegion(selected || 'unknown'))
  }, [])
  function changeRegion(value: string) { localStorage.setItem('joblite:legal-region', value); setRegion(value) }
  return { region, detected, changeRegion }
}

export function LegalPage() {
  const location = useLocation()
  const path = location.pathname.replace(/\/$/, '') || '/legal'
  const doc = documents[path]
  const { region, detected, changeRegion } = useLegalRegion()
  useEffect(() => applyPageMetadata({ title: `${doc?.title || 'Legal Center'} | Joblite AHIS`, description: doc?.description || 'Joblite policies, terms, privacy information, and user rights.', url: `${SITE_ORIGIN}${path}` }), [doc, path])
  return <main className="page jl-legal-page">
    <PageIntro title={doc?.title || 'Legal Center'} subtitle="Joblite AHIS · Aidomex Group Ltd" />
    <section className="card jl-legal-status"><strong>{DRAFT}</strong><span>Version {doc?.version || 'legal-index-v1-2026-10-24-draft'} · Effective date {EFFECTIVE_DATE}</span></section>
    <div className="jl-legal-region card">
      <label htmlFor="legal-region">Displayed legal region</label>
      <select id="legal-region" className="input" value={region} onChange={(event) => changeRegion(event.target.value)}>
        <option value="unknown">Unknown / protective baseline</option><option value="UG">Uganda</option><option value="EEA">European Economic Area</option><option value="UK">United Kingdom</option><option value="other">Other</option>
      </select>
      <p className="muted">Automatic estimate: {detected}. Cloudflare’s country estimate is approximate and does not establish residence. No GPS is requested. Your selection changes this displayed supplement only; it does not replace terms while travelling or using a VPN.</p>
      <p>{regionalNotes[region] || regionalNotes.unknown}</p>
    </div>
    {!doc ? <section className="card jl-legal-index">
      <p>These working policy drafts describe the current product and remain subject to qualified legal review. They are not a claim of certification, regulator approval, or universal compliance.</p>
      <h2>Policies</h2><ul>{Object.entries(documents).map(([href, item]) => <li key={href}><Link to={href}>{item.title}</Link> <span>· {item.version}</span></li>)}</ul>
      <h2>Operator</h2><p>Aidomex Group Ltd<br />Wakiso, Uganda<br />118472, Uganda<br /><a href="https://joblite.online/">https://joblite.online/</a></p>
      <h2>Product and legal review</h2><p>The current product has no billing, analytics SDK, advertising, external embeds, GPS collection, or in-product report/appeal workflow. Uganda PDPO registration and annual reporting status, cross-border safeguards, controller/processor roles, retention schedules, age/guardian handling, and EEA/UK targeting scope require confirmation and qualified review.</p>
    </section> : <>
      <nav className="card jl-legal-toc" aria-label="On this page"><strong>On this page</strong><ul>{doc.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ul></nav>
      <article className="card jl-legal-content"><p className="jl-legal-disclaimer">Working draft for review. This is not legal approval or a claim of complete compliance.</p>
        {doc.sections.map((section) => <section key={section.id} id={section.id}><h2>{section.title}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>)}
        <p>Related: <Link to="/legal">Legal Center</Link> · <Link to="/legal/privacy">Privacy Notice</Link> · <Link to="/legal/privacy-rights">Privacy Rights</Link> · <Link to="/legal/cookies">Privacy choices</Link></p>
      </article>
      {path === '/legal/privacy-rights' ? <PrivacyRequestPanel region={region} /> : null}
    </>}
  </main>
}

function PrivacyRequestPanel({ region }: { region: string }) {
  const session = useSession()
  const { openAuth } = useAuthExperience()
  const [kind, setKind] = useState('access')
  const [details, setDetails] = useState('')
  const [requests, setRequests] = useState<Array<{ id: string; request_type: string; status: string; created_at: number }>>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (session.user) apiGet<typeof requests>('/me/privacy-requests').then(({ data }) => setRequests(data)).catch((cause) => setError(errorMessage(cause))) }, [session.user])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!session.user || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { data } = await apiPost<(typeof requests)[number]>('/me/privacy-requests', { request_type: kind, details, region, language: 'en' })
      setRequests((current) => [data, ...current]); setDetails(''); setNotice('Your request was recorded. Its status is “received”; an operator must review and complete manual actions.')
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <section className="card jl-privacy-requests"><h2>Submit a privacy request</h2>
    {!session.user && !session.loading ? <><p>Sign in with your verified email to confirm access to this account before requesting its data.</p><button className="btn" onClick={() => openAuth({ intent: 'profile', nextPath: '/legal/privacy-rights' })}>Continue with email</button></> : session.loading ? <p role="status">Checking your session…</p> : <>
      <button className="btn btn-secondary" onClick={() => { window.location.href = '/api/v1/me/export' }}>Download my account export</button>
      <form className="form-grid" onSubmit={(event) => void submit(event)}><label>Request type<select className="input" value={kind} onChange={(event) => setKind(event.target.value)}><option value="access">Access my data</option><option value="correction">Correct my data</option><option value="deletion">Delete my account data</option><option value="export">Export my data</option><option value="objection">Object to processing</option><option value="withdraw_consent">Withdraw consent</option></select></label><label>Details (optional)<textarea className="input" value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} /></label><p className="muted">Requests are linked to your signed-in account. Deletion and other manual actions remain pending until reviewed; legal, application, security, and backup retention may apply.</p><button className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button></form>
      {notice && <p role="status" className="form-notice">{notice}</p>}{error && <p role="alert" className="form-error">{error}</p>}
      <h3>Request history</h3>{requests.length ? <ul>{requests.map((item) => <li key={item.id}>{item.request_type.replace(/_/g, ' ')} — {item.status} — {new Date(item.created_at * 1000).toLocaleString()}</li>)}</ul> : <p>No requests recorded on this account.</p>}
    </>}
  </section>
}

export function SiteFooter() {
  return <footer className="jl-global-footer"><span>© {new Date().getFullYear()} Aidomex Group Ltd · Joblite AHIS</span><nav aria-label="Legal and privacy links"><Link to="/legal">Legal Center</Link><Link to="/legal/terms">Terms</Link><Link to="/legal/privacy">Privacy</Link><Link to="/legal/cookies">Cookies</Link><Link to="/legal/privacy-rights">Privacy rights</Link></nav></footer>
}

export function PrivacyChoicesButton() {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(Boolean(localStorage.getItem('joblite:privacy-choice')))
  const [customizing, setCustomizing] = useState(false)
  const dialogRef = useRef<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const { region } = useLegalRegion()
  const session = useSession()
  useEffect(() => { const openDialog = () => { triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true) }; window.addEventListener('joblite:open-privacy-choices', openDialog); return () => window.removeEventListener('joblite:open-privacy-choices', openDialog) }, [])
  useEffect(() => {
    if (!open) { triggerRef.current?.focus({ preventScroll: true }); return }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey) }
  }, [open])
  async function record(choice: 'accept_optional'|'reject_optional', forcedAction?: 'consent_grant'|'consent_refusal'|'withdrawal') {
    const key = 'joblite:anonymous-choice-id'
    let anonymousId = localStorage.getItem(key)
    if (!anonymousId) { anonymousId = crypto.randomUUID(); localStorage.setItem(key, anonymousId) }
    const action = forcedAction || (choice === 'accept_optional' ? 'consent_grant' : 'consent_refusal')
    try { await apiPost('/legal/choices', { action, purpose: 'optional_tracking', anonymous_id: anonymousId, region, language: 'en' }) } catch { /* local privacy choice still applies if the network is unavailable */ }
    localStorage.setItem('joblite:privacy-choice', choice)
    setSaved(true); setOpen(false)
  }
  async function withdraw() {
    localStorage.setItem('joblite:privacy-choice', 'reject_optional')
    if (session.user) await apiPost('/me/privacy-consent/withdraw', { purpose: 'optional_tracking', region, language: 'en' }).catch(() => undefined)
    else await record('reject_optional', 'withdrawal')
    setSaved(true); setOpen(false)
  }
  return <>
    <button type="button" className="jl-privacy-trigger" onClick={(event) => { triggerRef.current = event.currentTarget; setOpen(true) }}>Privacy choices</button>
    {open ? <div className="jl-auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><section ref={dialogRef} className="jl-auth-dialog jl-privacy-dialog" role="dialog" aria-modal="true" aria-labelledby="privacy-choice-title" onKeyDown={(event) => { if (event.key !== 'Tab' || !dialogRef.current) return; const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')); const first = nodes[0]; const last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }}><header><strong id="privacy-choice-title">Privacy choices</strong><button className="jl-auth-close" aria-label="Close privacy choices" onClick={() => setOpen(false)}>×</button></header><div className="jl-auth-body"><p>Joblite currently has no optional analytics or advertising tools active. Your choice will be saved, but it does not turn on a tracker. Essential session and security storage remains active.</p><p><Link to="/legal/cookies" onClick={() => setOpen(false)}>Read the Cookies and Privacy Choices notice</Link></p>{customizing ? <div className="form-notice" role="status"><strong>Current optional categories</strong><p>No optional analytics, advertising, or marketing tracking tools are installed. There are no optional categories to enable today.</p><button className="btn btn-secondary" onClick={() => void record('reject_optional')}>Save current preferences</button></div> : null}<div className="button-row"><button className="btn" onClick={() => void record('accept_optional')}>Accept optional</button><button className="btn btn-secondary" onClick={() => void record('reject_optional')}>Reject optional</button><button className="btn btn-secondary" onClick={() => setCustomizing((value) => !value)}>Customize</button></div><button className="jl-auth-secondary" onClick={() => void withdraw()}>Withdraw optional choice</button>{saved && <p role="status">Your current choice is stored on this device.</p>}</div></section></div> : null}
  </>
}
