import { ListRowSkeleton } from "@/components/ui/Skeleton";

export default function ListLoading() {
  return (
    <div className="container-page py-10 sm:py-14">
      <div className="h-8 w-40 skeleton rounded-xl" />
      <div className="mt-6 flex flex-col gap-4">
        <ListRowSkeleton />
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    </div>
  );
}
