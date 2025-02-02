import {
  TreeDataProvider,
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState,
  Event,
  workspace,
  window,
} from "vscode";
import { DependencyTreeItem } from "./dependency";
import { PackageInfo } from "workspace-tools";
import pkgUp from "pkg-up";
import * as path from "path";
import { readJson } from "./readJson";
import {
  getDependencyTree,
  getWorkspaceRoot,
  getWorkspaceTool,
  getWorkspaces,
} from "./workspaces";

type TreeChangeEvent = DependencyTreeItem | undefined | null | void;

export class MonorepoDependenciesProvider
  implements TreeDataProvider<DependencyTreeItem>
{
  private _onDidChangeTreeData: EventEmitter<TreeChangeEvent> =
    new EventEmitter<TreeChangeEvent>();
  readonly onDidChangeTreeData: Event<TreeChangeEvent> =
    this._onDidChangeTreeData.event;

  workspaceRoot: string;
  workspacePkgJson: PackageInfo;
  workspaceTool!: string;
  rootPkg!: DependencyTreeItem;

  /**
   * Dependency graph for a given workspace root
   */
  graph: Map<string, Set<string>> = new Map<string, Set<string>>();

  /**
   * Map of packages in workspaceRoot
   */
  items: Map<string, DependencyTreeItem> = new Map();

  activePackage!: DependencyTreeItem;

  constructor(workspaceRoot: string, pkgJson: any) {
    this.workspaceRoot = workspaceRoot;
    this.workspacePkgJson = pkgJson;
  }

  /**
   * Forces the tree view to refresh
   */
  private refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get an inviditual tree item
   * @param element
   * @returns
   */
  getTreeItem(element: DependencyTreeItem): TreeItem {
    return element;
  }

  /**
   * Get a list of tree items, this fires for the top level and each element
   * @param element
   * @returns
   */
  async getChildren(
    element: DependencyTreeItem
  ): Promise<DependencyTreeItem[]> {
    const { items } = await this.loadDependencyTree(this.workspaceRoot);

    if (!element && !items.size) {
      return [];
    }

    // Return the top level tree
    if (!element && items.size) {
      const root = this.getRootItem(items);
      return root ? [root] : [];
    }

    if (element.root) {
      return Array.from(items.values());
    }

    if (element.workspace.children?.size) {
      const keys = Array.from(element.workspace.children.keys());
      return keys.map((name: string) => {
        const dep = items.get(name) as DependencyTreeItem;

        if (keys.includes(element.workspace.name)) {
          window.showInformationMessage(
            `Circular dependency: ${element.workspace.name} -> ${dep.workspace.name}`
          );
        }

        return dep;
      });
    }

    return [];
  }

  getRootItem(items: Map<string, DependencyTreeItem>) {
    const workspaceRoot = getWorkspaceRoot(this.workspaceRoot)!;
    const workspacePackage = readJson(path.join(workspaceRoot, "package.json"));
    const tool =
      workspace
        .getConfiguration("monorepoTools")
        .get<string>("workspaceToolOverride") ||
      getWorkspaceTool(workspaceRoot);

    this.workspaceTool = tool || "npm run";

    const rootDependency = new DependencyTreeItem(
      {
        ...workspacePackage,
        packageJsonPath: path.join(workspaceRoot, "package.json"),
        tool,
      },
      TreeItemCollapsibleState.Expanded,
      true
    );

    // This will show the number of packages in the workspace
    rootDependency.description = `${items.size} packages`;

    this.rootPkg = rootDependency;

    return rootDependency;
  }

  async getFirst() {
    const { items } = await this.loadDependencyTree(this.workspaceRoot);
    const [, pkg] = items.entries().next().value;
    return pkg;
  }

  /**
   * Load a dependency tree for a given root package.json
   */
  async loadDependencyTree(root: string) {
    const workspaces = getWorkspaces(root);
    const tree = getDependencyTree(workspaces);
    const tool =
      workspace
        .getConfiguration("monorepoTools")
        .get<string>("workspaceToolOverride") || getWorkspaceTool(root);

    const items = new Map<string, DependencyTreeItem>();
    // TODO: maybe find a way to not save state like this
    this.items = items;

    for (const [name, workspace] of Object.entries(workspaces)) {
      const children = tree.get(name) || new Set();
      const workspaceInfo = {
        ...workspace,
        tool,
        children,
      };
      const state = children.size
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None;

      items.set(name, new DependencyTreeItem(workspaceInfo, state));
    }

    return {
      workspaces,
      tree,
      tool,
      items,
    };
  }

  refreshGraph() {
    this.refresh();
  }

  /**
   * When the user changes the active file, we need to update the tree
   * @param root
   * @param pkgJson
   */
  async setActiveFile(filename: string) {
    const cwd = path.dirname(filename);

    const packageForFilename = (await pkgUp({ cwd })) as string;
    const workspaceRoot = getWorkspaceRoot(cwd)!;
    const activePackage = readJson(packageForFilename);
    const workspacePackage = readJson(path.join(workspaceRoot, "package.json"));

    const oldWorkspace = this.workspaceRoot;
    this.workspaceRoot = workspaceRoot;
    this.workspacePkgJson = workspacePackage;
    this.activePackage = this.items.get(activePackage.name)!;

    const shouldNotRefreshTree = workspaceRoot === oldWorkspace;
    if (shouldNotRefreshTree) {
      return;
    }

    this.refresh();
  }

  /**
   * Resets the current graph
   */
  clearGraph() {
    this.graph = new Map<string, Set<string>>();
    this.items = new Map<string, DependencyTreeItem>();
  }

  statusText() {
    return this.workspacePkgJson
      ? `Workspace: ${this.workspacePkgJson.name}, ${this.items.size} packages`
      : "Workspace: Loading...";
  }

  titleText() {
    if (!this.workspacePkgJson) {
      return "Workspace: Loading...";
    }

    return "Dependency Graph";
  }
}
