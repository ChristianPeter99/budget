import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * Fängt Darstellungsfehler ab, damit statt eines leeren Bildschirms eine verständliche Meldung erscheint.
 * Es wird nichts protokolliert oder angezeigt, was Finanzdaten enthalten könnte.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onHome?: () => void; homeLabel?: string; sheet?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(_e: unknown, _info: ErrorInfo): void { /* bewusst ohne Ausgabe von Fehlerdetails */ }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const box = (
      <div className="card stack" role="alert">
        <b>Diese Ansicht konnte nicht angezeigt werden.</b>
        <span className="cap">Deine Daten sind sicher gespeichert. Lade die App neu oder wechsle zur Übersicht.</span>
        <button className="btn" onClick={() => window.location.reload()}>Neu laden</button>
        {this.props.onHome && <button className="btn sec2" onClick={() => { this.setState({ failed: false }); this.props.onHome?.(); }}>{this.props.homeLabel ?? 'Zur Übersicht'}</button>}
      </div>
    );
    return this.props.sheet ? <div className="sheetwrap"><div className="bd" /><div className="panel">{box}</div></div> : box;
  }
}
