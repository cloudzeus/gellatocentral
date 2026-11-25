// Το μόνο κεντρικό σημείο όπου το Next λέει «ξεκίνησε πλοήγηση»: το ακούει η γραμμή φόρτωσης (components/feedback/top-progress.tsx).
export function onRouterTransitionStart(url: string) {
  window.dispatchEvent(new CustomEvent<string>("gs:nav-start", { detail: url }));
}
