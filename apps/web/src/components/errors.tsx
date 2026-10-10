import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { messageOf } from "../lib/api";
import { Alert, Button } from "./ui";

/** Anything a screen didn't handle: say what happened and offer a retry. */
export function ScreenError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Alert
        tone="error"
        title="This screen couldn't load"
        action={
          <Button
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            Try again
          </Button>
        }
      >
        {messageOf(error)}
      </Alert>
    </div>
  );
}

export function NotFound() {
  return (
    <main className="safe-x safe-top mx-auto max-w-2xl py-10">
      <h1 className="text-3xl font-bold text-navy">Page not found</h1>
      <p className="mt-2 text-lg">
        That address isn't part of the app.{" "}
        <Link to="/" className="font-semibold text-blue underline">
          Go to the start screen
        </Link>
        .
      </p>
    </main>
  );
}
