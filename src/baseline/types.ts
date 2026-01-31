// Shared types for Baseline feature data and descriptor DSL.

export type WebFeaturesBaseline = "high" | "low" | false;

export interface MinFeatureRecord {
  id: string;
  name?: string;
  group?: string;
  status?: {
    baseline?: WebFeaturesBaseline;
    baseline_low_date?: string;
    baseline_high_date?: string;
    support?: Record<string, string>;
  };
  discouraged?: unknown;
}

export type FeatureMap = Readonly<Record<string, MinFeatureRecord>>;

// Descriptor DSL — data-driven detection patterns
export type DescriptorKind =
  | "newIdent"
  | "newMember"
  | "callStatic"
  | "callGlobal"
  | "member"
  | "instanceMember"
  | "callMemberWithArgs"
  | "newWithOptions";

export interface BaseDescriptor {
  featureId: string; // web-features ID (e.g. 'abortsignal-any')
  kind: DescriptorKind;
  // When true, only enable this descriptor when typed mode is active
  typedOnly?: boolean;
}

export interface NewIdentDescriptor extends BaseDescriptor {
  kind: "newIdent";
  name: string; // e.g. 'PaymentRequest'
}

export interface NewMemberDescriptor extends BaseDescriptor {
  kind: "newMember";
  base: string; // e.g. 'Intl'
  prop: string; // e.g. 'Segmenter'
}

export interface CallStaticDescriptor extends BaseDescriptor {
  kind: "callStatic";
  base: string; // e.g. 'AbortSignal'
  prop: string; // e.g. 'any'
}

export interface CallGlobalDescriptor extends BaseDescriptor {
  kind: "callGlobal";
  name: string; // e.g. 'structuredClone', 'queueMicrotask'
}

export interface MemberDescriptor extends BaseDescriptor {
  kind: "member";
  base: string; // e.g. 'navigator'
  prop: string; // e.g. 'userActivation'
}

export type Descriptor =
  | NewIdentDescriptor
  | NewMemberDescriptor
  | CallStaticDescriptor
  | CallGlobalDescriptor
  | MemberDescriptor
  | InstanceMemberDescriptor
  | CallMemberWithArgsDescriptor
  | NewWithOptionsDescriptor;

export interface InstanceMemberDescriptor extends BaseDescriptor {
  kind: "instanceMember";
  iface: string; // receiver interface/type name, e.g. 'Element', 'Response'
  prop: string; // property/method name, e.g. 'animate', 'arrayBuffer'
}

export interface CallMemberWithArgsDescriptor extends BaseDescriptor {
  kind: "callMemberWithArgs";
  prop: string; // method name on the receiver, e.g. 'getContext', 'includes'
  stringArg?: { index: number; values: string[] };
  objectArg?: {
    index: number;
    hasKeys?: string[];
    keyValues?: Array<{ key: string; values?: string[] }>;
  };
  viaCall?: { prop: string }; // receiver is a call result like obj.getSupportedExtensions()
}

export interface NewWithOptionsDescriptor extends BaseDescriptor {
  kind: "newWithOptions";
  name: string; // e.g. 'Worker', 'SharedWorker', 'TransformStream'
  objectArg: {
    index: number;
    hasKeys?: string[];
    keyValues?: Array<{ key: string; values?: string[] }>;
  };
}
