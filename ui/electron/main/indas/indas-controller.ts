/**
 * IndasController: the Electron adapter around IndasPipelineService (docs/17). It adds the file dialogs,
 * progress events and "show in folder". All pipeline rules stay in the service (tested without Electron).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dialog, shell, type BrowserWindow } from 'electron'
import type {
  ConceptSuggestion,
  GenerateXmlInput,
  GenerateXmlResult,
  IndasDetails,
  IndasOpened,
  IndasSaved,
  IndasSaveRequest,
  MasterFields,
  ProjectPick,
  RecommendRequest,
  SheetTree,
  CheckResult,
  StatementLine,
  TransformResult,
} from '@shared/indas'
import type { IndasPipelineService } from '../services/indas-pipeline-service'
import type { IndasProjectService } from '../services/indas-project-service'
import { AXBRL_EXTENSION } from '../project/axbrl'

export const TEMPLATE_FILE_NAME = 'XBRL_Autopilot_Standard_Template.xlsx'
const EXCEL_FILTERS = [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }]
const PROJECT_FILTERS = [{ name: 'XBRL Autopilot project', extensions: [AXBRL_EXTENSION.slice(1)] }]

export class IndasController {
  private lastGenerated: string | null = null

  constructor(
    private readonly service: IndasPipelineService,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly projectsDir: () => string,
    private readonly onProgress: (done: number, total: number) => void,
    private readonly projects: IndasProjectService,
    /** Recent filings: the project goes on top when it is created, opened or saved */
    private readonly recent: { remember(path: string): Promise<void> } = { remember: async () => {} },
  ) {}

  async save(req: IndasSaveRequest): Promise<IndasSaved> {
    const saved = await this.projects.save(req)
    await this.recent.remember(saved.path)
    return saved
  }

  async open(path: string): Promise<IndasOpened> {
    const opened = await this.projects.open(path)
    await this.recent.remember(path)
    return opened
  }

  /** New project (File → New project): saved straight away in the projects folder. */
  async create(details: IndasDetails): Promise<IndasOpened> {
    const opened = await this.projects.create(details)
    await this.recent.remember(opened.path)
    return opened
  }

  /** File → Open: asks for a project file and says which editor it belongs to. `null` = cancelled. */
  async pickProject(): Promise<ProjectPick | null> {
    const opts = { title: 'Open project', properties: ['openFile' as const], filters: PROJECT_FILTERS, defaultPath: this.projectsDir() }
    const win = this.getWindow()
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const path = canceled ? undefined : filePaths[0]
    return path ? { path, kind: await this.projects.kindOf(path) } : null
  }

  /** Asks where to save the standard template and writes it. `null` = cancelled. */
  async saveTemplate(): Promise<string | null> {
    const opts = { title: 'Save standard template', defaultPath: join(this.projectsDir(), TEMPLATE_FILE_NAME), filters: [EXCEL_FILTERS[0]] }
    const win = this.getWindow()
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (canceled || !filePath) return null
    await writeFile(filePath, await this.service.template())
    return filePath
  }

  /** Converts the workbook at `path`, or asks for one. `null` = cancelled. */
  async transform(path?: string): Promise<TransformResult | null> {
    if (path) return this.convert(path)
    const opts = { title: 'Open financial statements', properties: ['openFile' as const], filters: EXCEL_FILTERS, defaultPath: this.projectsDir() }
    const win = this.getWindow()
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = canceled ? undefined : filePaths[0]
    return file ? this.convert(file) : null
  }

  private async convert(file: string): Promise<TransformResult> {
    if (!/\.xlsx?$/i.test(file)) throw new Error('Choose an Excel workbook (.xls or .xlsx)')
    return this.service.transform(basename(file), new Uint8Array(await readFile(file)))
  }

  recommend(req: RecommendRequest): Promise<ConceptSuggestion[][]> {
    return this.service.recommend(req, 3, this.onProgress)
  }

  masterFields(): Promise<MasterFields> {
    return this.service.masterFields()
  }

  tree(scope: string, kind: 'concept' | 'member'): Promise<SheetTree[]> {
    return this.service.tree(scope, kind)
  }

  check(rows: StatementLine[]): Promise<CheckResult> {
    return this.service.check(rows)
  }

  async generate(input: GenerateXmlInput): Promise<GenerateXmlResult> {
    const r = await this.service.generate(input)
    if (r.ok) this.lastGenerated = r.path
    return r
  }

  /** Opens the folder of the last generated XML with the file selected. */
  showGenerated(): void {
    if (this.lastGenerated) shell.showItemInFolder(this.lastGenerated)
  }
}
