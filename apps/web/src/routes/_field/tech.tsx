import { createFileRoute } from "@tanstack/react-router";
import { ButtonLink, Card, PageHeader } from "../../components/ui";
import { useTitle } from "../../lib/useTitle";

/** The tech's home on the iPad. Day view, jobs and the scoreboard come later (docs/04, month 4). */
export const Route = createFileRoute("/_field/tech")({
  component: TechHome,
});

function TechHome() {
  const { me } = Route.useRouteContext();
  useTitle("Home");
  const firstName = me.user.name.split(" ")[0] ?? me.user.name;
  return (
    <div className="space-y-5">
      <PageHeader title={`Hi, ${firstName}`} subtitle="Your jobs will show here." />
      <Card title="Scoreboard">
        <p className="text-xl leading-relaxed">
          Your scoreboard turns on when the pay plan rolls out after the switch.
        </p>
        <p className="mt-2 text-base text-muted">
          Until then your pay stays exactly as it is today.
        </p>
      </Card>
      <Card title="GPS test">
        <p className="mb-4 text-lg">
          Help us check that this iPad's location works well enough for the dispatch map. Nothing is
          sent anywhere yet.
        </p>
        <ButtonLink to="/gps-test" variant="primary" className="w-full sm:w-auto">
          Open the GPS test
        </ButtonLink>
      </Card>
    </div>
  );
}
