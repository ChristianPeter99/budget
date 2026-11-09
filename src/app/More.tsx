import { Suspense, lazy, useState } from 'react';
import type { Recurring, Transaction } from '../domain/types';
import type { TxPreset } from '../domain/transactions';
import { useStore } from '../state/store';
import { Back, Header } from '../ui/Header';
import { JointPage } from '../features/joint/Joint';
import { Sparen } from '../features/sparen/Sparen';
import { Bookings } from '../features/bookings/Bookings';
import { RecurringPage } from '../features/income/Income';
import { CategoriesPage } from '../features/categories/Categories';
import { BudgetsPage } from '../features/budgets/Budgets';
import { BackupScreen } from '../features/backup/BackupScreen';
import { Icon } from '../ui/icons';
import { Chevr } from '../ui/Collapse';

// Selten gebraucht: Auswertung und Import werden erst beim Öffnen geladen (schnellerer Start)
const Stats = lazy(() => import('../features/stats/Stats').then((m) => ({ default: m.Stats })));
const ImportPage = lazy(() => import('../features/import/Import').then((m) => ({ default: m.ImportPage })));
function PageLoading({ back }: { back: React.ReactNode }) { return <>{back}<div className="pageload" aria-busy="true" /></>; }

export type MorePage = 'menu' | 'joint' | 'spar' | 'bookings' | 'stats' | 'recurring' | 'categories' | 'budgets' | 'settings' | 'backup' | 'import';
type Page = MorePage;

export interface MoreProps {
  initial?: Page;
  /** Zurück zum Reiter, von dem aus die Seite direkt geöffnet wurde */
  onExit: () => void;
  onOpenTx: (t: Transaction) => void;
  onAdd: (p: TxPreset) => void;
  onEditRec: (r: Recurring) => void;
}

export function More({ initial = 'menu', onExit, onOpenTx, onAdd, onEditRec }: MoreProps) {
  const [page, setPage] = useState<Page>(initial);
  const { data } = useStore();
  const direct = initial !== 'menu' && page === initial;
  const back = <Back label={direct ? 'Zurück' : 'Mehr'} onClick={() => (direct ? onExit() : setPage('menu'))} />;
  if (page === 'joint') return <JointPage back={back} />;
  if (page === 'spar') return <Sparen back={back} onAdd={onAdd} onEditRec={onEditRec} />;
  if (page === 'bookings') return <Bookings back={back} onOpenTx={onOpenTx} onDuplicate={onAdd} />;
  if (page === 'stats') return <Suspense fallback={<PageLoading back={back} />}><Stats back={back} /></Suspense>;
  if (page === 'recurring') return <RecurringPage back={back} />;
  if (page === 'categories') return <CategoriesPage back={back} />;
  if (page === 'budgets') return <BudgetsPage back={back} />;
  if (page === 'settings') return <BackupScreen back={back} />;
  if (page === 'backup') return <BackupScreen back={back} />;
  if (page === 'import') return <Suspense fallback={<PageLoading back={back} />}><ImportPage back={back} /></Suspense>;
  // In drei Gruppen: Geld, Einrichten, Daten
  const groups: [string, [Page, string, string, string][]][] = [
    ['Geld', [
      ['spar', 'piggy', 'Sparen & Depot', ''],
      ['joint', 'Gemeinsames Konto', 'Gemeinsames Konto', data.settings.joint?.enabled ? data.settings.joint.name : 'aus'],
      ['stats', 'chart', 'Auswertung', '']
    ]],
    ['Einrichten', [
      ['categories', 'tag', 'Kategorien', ''],
      ['recurring', 'Gehalt', 'Wiederkehrende Einnahmen', ''],
      ['budgets', 'target', 'Budgets', '']
    ]],
    ['Daten', [
      ['import', 'arrowdown', 'Import', 'CSV · PDF'],
      ['backup', 'lock', 'Daten & Backup', data.lastBackupAt ? 'gesichert' : 'fehlt']
    ]]
  ];
  return (
    <>
      <Header title="Mehr" keepLine />
      {groups.map(([g, items]) => (
        <section key={g} className="moregroup" aria-label={g}>
          <span className="cap">{g}</span>
          <div className="card flush">
            {items.map(([p, ic, l, s]) => (
              <button className="link" key={p} onClick={() => setPage(p)}><span style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Icon name={ic} />{l}</span><small className={s === 'fehlt' ? 'warnval' : undefined}>{s === 'fehlt' && <i className="wdot" aria-hidden="true" />}{s}<Chevr /></small></button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
