import { Link, createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Hello, flea market</h1>
      <p className="mt-4 text-lg">
        <Link to="/page-two" className="text-blue-600 underline">
          Page two
        </Link>
      </p>
      <div className="mt-8 flex gap-3">
        <Button>Default Button</Button>
        <Button variant="outline">Outline</Button>
        <Sheet>
          <SheetTrigger render={<Button variant="secondary">Open Sheet</Button>} />
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet works</SheetTitle>
              <SheetDescription>
                Portal, overlay, slide animation, and close button render.
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
