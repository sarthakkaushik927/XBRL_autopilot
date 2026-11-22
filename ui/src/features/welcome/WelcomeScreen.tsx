import { Download, FilePlus2, FolderOpen, FolderTree, History, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { openIndasProject, openProjectFile } from '@/app/filings'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { useProject } from '@/stores/project'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Card(props: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-border bg-panel', props.className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-semibold">
        {props.icon}
        {props.title}
      </header>
      <div className="p-2">{props.children}</div>
    </section>
  )
}

/** Shown when no filing is open: New project, Open, the template, Recent filings and Saved projects (Ind AS). */
export function WelcomeScreen() {
  const saveTemplate = useIndas((s) => s.saveTemplate)
  // the current architecture only (Sarthak, 2026-11-22): main lists Ind AS projects in Recent and Saved
  const { recent, saved, openNewFiling, forgetRecent, openProjectsFolder } = useProject()
  const openPath = (path: string) => void openIndasProject(path)
  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
        <div>
          <h1 className="text-xl font-semibold">XBRL Autopilot</h1>
          <p className="mt-1 text-sm text-muted">Prepare MCA AOC-4 XBRL filings from Excel — AI-assisted tagging, validation and fixes.</p>
        </div>

        <section className="rounded-md border border-accent/40 bg-panel p-4" data-testid="welcome-start">
          <p className="text-xs text-muted">
            Create a project for the company and year, open the client's financial statements (or our filled standard template), review the tags the AI suggests, fill the company details and generate the AOC-4 XML.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={openNewFiling} data-testid="welcome-new-project">
              <FilePlus2 size={15} /> New project
            </Button>
            <Button onClick={() => void openProjectFile()} data-testid="welcome-open">
              <FolderOpen size={15} /> Open…
            </Button>
            <Button variant="ghost" onClick={() => void saveTemplate()} data-testid="welcome-indas-template">
              <Download size={15} /> Download standard template
            </Button>
          </div>
        </section>

        <Card title="Recent filings" icon={<History size={14} className="text-muted" />}>
          {recent.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted">No recent filings. Create a project to get started.</p>
          ) : (
            <ul>
              {recent.map((r) => (
                <li key={r.path} className="group flex items-center gap-3 rounded px-2 py-1.5 hover:bg-panel-2">
                  <button
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                    disabled={!r.exists}
                    title={r.exists ? r.path : 'File not found'}
                    onClick={() => openPath(r.path)}
                  >
                    <div className="truncate text-[13px]">
                      {r.company} <span className="text-muted">· {r.fy}</span>
                    </div>
                    <div className="truncate text-[11px] text-muted">{r.exists ? r.path : `Missing: ${r.path}`}</div>
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{r.cin}</span>
                  <button
                    className="text-muted opacity-0 group-hover:opacity-100 hover:text-fg"
                    title="Remove from list"
                    onClick={() => void forgetRecent(r.path)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Saved projects" icon={<FolderTree size={14} className="text-muted" />}>
          <div className="flex items-center gap-2 px-2 pb-2 text-[11px] text-muted">
            <span className="min-w-0 flex-1 truncate" title={saved.dir}>
              {saved.dir || 'Projects folder'}
            </span>
            <Button variant="ghost" onClick={() => void openProjectsFolder()} data-testid="welcome-open-projects-folder">
              <FolderOpen size={13} /> Show folder
            </Button>
          </div>
          {saved.projects.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted">No projects saved here yet. New filings are saved to this folder by default.</p>
          ) : (
            <ul data-testid="welcome-saved-projects">
              {saved.projects.map((p) => (
                <li key={p.path}>
                  <button className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-panel-2" title={p.path} onClick={() => openPath(p.path)}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">
                        {p.company} <span className="text-muted">· {p.fy}</span>
                        <span className="ml-2 rounded bg-accent/10 px-1 text-[10px] text-accent">Ind AS</span>
                      </div>
                      <div className="truncate text-[11px] text-muted">
                        {p.fileName} · saved {when(p.updatedAt)}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-muted">{p.cin}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
