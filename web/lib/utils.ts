import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Το `cn` του shadcn (για τα components που έρχονται από εκεί). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
