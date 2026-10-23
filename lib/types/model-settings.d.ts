/** Persistent Kiro model visibility and deterministic catalog ordering. */
import type { KiroCatalogModel } from './adapter.ts';
export interface KiroModelSettings {
    enabledModelIds: readonly string[];
    knownModelIds: readonly string[];
    updatedAt: number;
}
/** Default storage path; kept beside, but independent from, managed credentials. */
export declare function modelSettingsPath(): string;
/** Sort models by family, newest numeric version, then preferred variant. */
export declare function compareKiroModels(a: KiroCatalogModel, b: KiroCatalogModel): number;
/** Serialize model-settings writes so concurrent checkbox changes cannot race. */
export declare class FileModelSettingsStore {
    private readonly file;
    private chain;
    constructor(file?: string);
    read(): Promise<KiroModelSettings>;
    private write;
    private modify;
    /**
     * Merge a fresh catalog, enabling first-run and newly discovered model ids.
     *
     * An explicit "nothing enabled" selection is a state the user can create with
     * the Deselect all button, so a merge must not silently undo it: the user
     * turned those models off and a background refresh is no answer to that. What
     * a merge must still repair is the other, accidental emptiness — a selection
     * that was non-empty and lost every id to a partial catalog, another account,
     * or a region switch — which falls back to the catalog it just observed.
     */
    mergeCatalog(models: readonly KiroCatalogModel[]): Promise<KiroModelSettings>;
    /**
     * Persist an exact checkbox selection, constrained to the current catalog.
     *
     * Clearing every box is a real choice — the Deselect all button exists to make
     * it — so it is stored as it was asked for. The route then publishes no model
     * until the user re-enables one from Settings → Kiro, which reads the whole
     * discovered catalog and is therefore always able to undo this. Treating the
     * empty request as "reset to everything" instead makes that button a no-op,
     * which is exactly the bug this method refuses to reproduce.
     */
    setEnabledModelIds(enabledModelIds: readonly string[], models: readonly KiroCatalogModel[]): Promise<KiroModelSettings>;
    /**
     * Resolve enabled models.
     *
     * `knownModelIds` is the only "never configured" signal: while it is empty the
     * installation has no stored choice and everything is enabled. Once it is
     * populated, `enabledModelIds` is the exact selection and an empty one means
     * empty — an older build's empty file heals on read, a deliberate one does
     * not.
     */
    enabledModels(models: readonly KiroCatalogModel[]): Promise<readonly KiroCatalogModel[]>;
}
/**
 * Project a full catalog into the compact checkbox API shape.
 *
 * The full catalog is always projected, never only the enabled subset: this is
 * the payload the settings card renders, so it has to keep listing the models a
 * user turned off in order to be able to turn them back on.
 */
export declare function modelSelection(store: FileModelSettingsStore, models: readonly KiroCatalogModel[]): Promise<{
    enabledModelIds: readonly string[];
    models: readonly (KiroCatalogModel & {
        enabled: boolean;
    })[];
}>;
