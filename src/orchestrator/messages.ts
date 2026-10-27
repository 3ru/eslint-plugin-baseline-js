import { baselineYearLabel, getFeatureRecord, getFeatureStatus } from "../baseline/resolve";
import type {
  CallMemberWithArgsDescriptor,
  Descriptor,
  NewWithOptionsDescriptor,
} from "../baseline/types";
import type { BaselineOption } from "../config";

export function baselineMessage(
  featureId: string,
  baseline: BaselineOption,
  subject?: string,
  compatKey?: string,
) {
  const feature = getFeatureRecord(featureId);
  const label = subject ?? `'${feature?.name ?? featureId}'`;
  const status = getFeatureStatus(featureId, compatKey);
  const target =
    baseline === "widely"
      ? "Widely available"
      : baseline === "newly"
        ? "Newly available"
        : baseline;
  let reason: string;

  if (status?.baseline === false) {
    reason = "It has Limited availability.";
  } else if (typeof baseline === "number") {
    reason = `Its Baseline year is ${baselineYearLabel(status) ?? "unknown"}.`;
  } else if (status?.baseline === "low") {
    reason = "It is Baseline Newly available.";
  } else if (status?.baseline === "high") {
    reason = "It is Baseline Widely available.";
  } else {
    reason = "Its Baseline status is unknown.";
  }

  return `${label} does not meet your Baseline ${target} target. ${reason} Feature ID: ${featureId}.`;
}

export function delegateSubject(name: string): string {
  return `'${name}'`;
}

export function descriptorSubject(descriptor: Descriptor): string {
  switch (descriptor.kind) {
    case "newIdent":
    case "callGlobal":
      return `'${descriptor.name}'`;
    case "newMember":
    case "callStatic":
    case "member":
    case "staticMember":
      return `'${descriptor.base}.${descriptor.prop}'`;
    case "instanceMember":
      return `The '${descriptor.prop}' member of ${descriptor.iface} instances`;
    case "callMemberWithArgs":
    case "newWithOptions":
      return callSubject(descriptor);
  }
}

function callSubject(descriptor: CallMemberWithArgsDescriptor | NewWithOptionsDescriptor) {
  const args: string[] = [];
  const objectArg = descriptor.objectArg;

  if (descriptor.kind === "callMemberWithArgs" && descriptor.stringArg) {
    args[descriptor.stringArg.index] = descriptor.stringArg.values
      .map((value) => JSON.stringify(value))
      .join(" | ");
  }

  if (objectArg) {
    const properties = new Map<string, string>();

    for (const key of objectArg.hasKeys ?? []) {
      properties.set(key, "...");
    }

    for (const { key, values } of objectArg.keyValues ?? []) {
      properties.set(key, values?.map((value) => JSON.stringify(value)).join(" | ") || "...");
    }

    args[objectArg.index] =
      `{ ${Array.from(properties, ([key, value]) => `${key}: ${value}`).join(", ")} }`;
  }

  const argumentsText = Array.from(args, (argument) => argument ?? "...").join(", ");

  if (descriptor.kind === "newWithOptions") {
    return `new ${descriptor.name}(${argumentsText})`;
  }

  const receiver = descriptor.viaCall ? `${descriptor.viaCall.prop}().` : "";

  return `${receiver}${descriptor.prop}(${argumentsText})`;
}
