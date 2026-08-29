/*
 * Transitional surface: everything here is being re-pointed at the shadcn/ui
 * layer (@/components + @/components/ui) board by board, and this module is
 * deleted once the last board imports the new paths directly.
 */
export { Btn, IconBtn, btnVariants } from "./button";
export { Field, TextArea, SelectField, FieldGroup } from "./field";
export { Card, CardHeader } from "./card";
export { StatTile, MiniStat } from "@/components/stat";
export { Table, MiniTable, THead, TBody, TR, TH, TD, NumTD, MonoTD } from "./table";
export { Status, ProtoBadge, OutlineTag } from "@/components/status";
export { Seg, type SegOption } from "./segmented";
export { Sw } from "./switch";
export { LineChart, type Series } from "@/components";
export { ChartBox, Bar, SectionLabel, KV, MeterRow, WarnBanner } from "@/components";
export { Placeholder, SettingRow, Check } from "./misc";
export { Sheet, SheetHeader, SheetBody, SheetFooter } from "./sheet";
export { Dialog } from "./dialog";
export { ConfirmProvider, useConfirm, type ConfirmRequest } from "@/components/confirm";
export { toast, useToast, type ToastApi, type ToastOptions, type ToastTone } from "@/components/toast";
export { Toaster } from "@/components/sonner";
export { Menu, MenuItem, MenuSeparator } from "./menu";
export { JsonBlock, IND, JStr, JNum, JDim, Timeline, type TraceStep } from "@/components/json-block";
