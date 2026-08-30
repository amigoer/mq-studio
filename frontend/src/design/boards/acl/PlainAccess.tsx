import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Panel, SectionLabel, SelectField, useConfirm, useToast } from "@/components";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as aclApi from "@/api/acl";
import { formatErrorMessage } from "@/lib/utils";

const PERMS = ["DENY", "PUB", "SUB", "PUB|SUB"] as const;

function splitLines(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((one) => one.trim())
    .filter((one) => one !== "");
}

/**
 * RocketMQ 4.x plain_acl, which can be written and never read.
 *
 * There is no listing here and it is not an omission: the 4.x admin protocol
 * has no call that returns plain_acl.yml, so every field starts empty and an
 * AccessKey is deleted by typing it from memory. The banner says that rather
 * than leaving somebody to work it out from an empty table.
 *
 * The global allow list is the sharp edge. The only RPC that touches it
 * overwrites it, so saving replaces whatever the broker holds with what is in
 * the box — including, if the box is short, the entry that lets the caller
 * reach the broker at all.
 */
export function PlainAccess() {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const toast = useToast();
  const confirm = useConfirm();

  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [whiteRemote, setWhiteRemote] = useState("*");
  const [admin, setAdmin] = useState(false);
  const [topicPerm, setTopicPerm] = useState<string>("DENY");
  const [groupPerm, setGroupPerm] = useState<string>("SUB");
  const [topicPerms, setTopicPerms] = useState("");
  const [groupPerms, setGroupPerms] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteKey, setDeleteKey] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [allowList, setAllowList] = useState("");
  const [savingAllowList, setSavingAllowList] = useState(false);

  const save = async () => {
    if (accessKey.trim() === "" || secretKey === "") return;
    setSaving(true);
    try {
      await aclApi.createOrUpdateAccessConfig(
        connID,
        accessKey.trim(),
        secretKey,
        whiteRemote.trim(),
        admin,
        topicPerm,
        groupPerm,
        splitLines(topicPerms),
        splitLines(groupPerms),
      );
      toast.success(t("board.acl.plain.saved", { key: accessKey.trim() }));
      setSecretKey("");
    } catch (failure) {
      toast.error(t("board.acl.plain.saveFailed"), { description: formatErrorMessage(failure) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const key = deleteKey.trim();
    if (key === "") return;
    const confirmed = await confirm({
      title: t("board.acl.plain.deleteTitle"),
      description: t("board.acl.plain.deleteDesc", { key }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await aclApi.deleteAccessConfig(connID, key);
      toast.success(t("board.acl.plain.deleted", { key }));
      setDeleteKey("");
    } catch (failure) {
      toast.error(t("board.acl.plain.deleteFailed"), { description: formatErrorMessage(failure) });
    } finally {
      setDeleting(false);
    }
  };

  const replaceAllowList = async () => {
    const addresses = splitLines(allowList);
    const confirmed = await confirm({
      title: t("board.acl.plain.allowListTitle"),
      description: t("board.acl.plain.allowListConfirm", { count: addresses.length }),
      confirmLabel: t("board.acl.plain.allowListReplace"),
      danger: true,
    });
    if (!confirmed) return;
    setSavingAllowList(true);
    try {
      await aclApi.updateGlobalWhiteAddrs(connID, addresses);
      toast.success(t("board.acl.plain.allowListSaved", { count: addresses.length }));
    } catch (failure) {
      toast.error(t("board.acl.plain.allowListFailed"), {
        description: formatErrorMessage(failure),
      });
    } finally {
      setSavingAllowList(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel className="flex items-start gap-2.5 p-3">
        <TriangleAlert size={14} style={{ color: "var(--c-warn-text)" }} aria-hidden />
        <p className="m-0 text-xs leading-relaxed text-(--c-fg-2)">
          {t("board.acl.plain.blindNote")}
        </p>
      </Panel>

      <Panel className="flex flex-col gap-3 p-4">
        <SectionLabel>{t("board.acl.plain.entryTitle")}</SectionLabel>
        <FieldGroup className="gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="plain-ak">AccessKey</FieldLabel>
              <Input
                id="plain-ak"
                className="mono3"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="plain-sk">SecretKey</FieldLabel>
              <Input
                id="plain-sk"
                type="password"
                value={secretKey}
                onChange={(event) => setSecretKey(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="plain-white">{t("board.acl.plain.whiteRemote")}</FieldLabel>
              <Input
                id="plain-white"
                className="mono3"
                value={whiteRemote}
                onChange={(event) => setWhiteRemote(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>{t("board.acl.plain.defaultTopicPerm")}</FieldLabel>
              <SelectField
                size="default"
                className="w-full"
                value={topicPerm}
                onValueChange={setTopicPerm}
                options={PERMS.map((value) => ({ value }))}
              />
            </Field>
            <Field>
              <FieldLabel>{t("board.acl.plain.defaultGroupPerm")}</FieldLabel>
              <SelectField
                size="default"
                className="w-full"
                value={groupPerm}
                onValueChange={setGroupPerm}
                options={PERMS.map((value) => ({ value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="plain-topics">{t("board.acl.plain.topicPerms")}</FieldLabel>
              <Textarea
                id="plain-topics"
                className="mono3 h-20"
                value={topicPerms}
                placeholder={"orders=PUB|SUB\naudit=SUB"}
                onChange={(event) => setTopicPerms(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="plain-groups">{t("board.acl.plain.groupPerms")}</FieldLabel>
              <Textarea
                id="plain-groups"
                className="mono3 h-20"
                value={groupPerms}
                placeholder={"order-settle=SUB"}
                onChange={(event) => setGroupPerms(event.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-1.5 text-sm">
            <Switch checked={admin} onCheckedChange={setAdmin} />
            {t("board.acl.plain.admin")}
          </label>
        </FieldGroup>

        <div className="flex justify-end">
          <Button
            disabled={!online || saving || accessKey.trim() === "" || secretKey === ""}
            onClick={() => void save()}
          >
            {saving && <Spinner />}
            {t("board.acl.plain.save")}
          </Button>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3">
        <Panel className="flex flex-col gap-3 p-4">
          <SectionLabel>{t("board.acl.plain.deleteTitle")}</SectionLabel>
          <p className="m-0 text-xs leading-relaxed text-(--c-muted)">
            {t("board.acl.plain.deleteHint")}
          </p>
          <div className="flex gap-2">
            <Input
              className="mono3 min-w-0 flex-1"
              value={deleteKey}
              placeholder="AccessKey"
              onChange={(event) => setDeleteKey(event.target.value)}
            />
            <Button
              variant="destructive"
              disabled={!online || deleting || deleteKey.trim() === ""}
              onClick={() => void remove()}
            >
              {deleting && <Spinner />}
              {t("board.common.delete")}
            </Button>
          </div>
        </Panel>

        <Panel className="flex flex-col gap-3 p-4">
          <SectionLabel>{t("board.acl.plain.allowListTitle")}</SectionLabel>
          <p className="m-0 text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.acl.plain.allowListWarning")}
          </p>
          <Textarea
            className="mono3 h-20"
            value={allowList}
            placeholder={"127.0.0.1\n192.168.*.*"}
            onChange={(event) => setAllowList(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="destructive"
              disabled={!online || savingAllowList}
              onClick={() => void replaceAllowList()}
            >
              {savingAllowList && <Spinner />}
              {t("board.acl.plain.allowListReplace")}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
