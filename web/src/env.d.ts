/// <reference types="astro/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  import type { LucideIcon } from "@lucide/vue";
  const component: DefineComponent;
  export type IconComponent = LucideIcon;
  export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";
  export default component;
}
