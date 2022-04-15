import { Prisma } from "@prisma/client";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { GetServerSidePropsContext } from "next";
import { JSONObject } from "superjson/dist/types";

import { getLocationLabels } from "@calcom/app-store/utils";

import { asStringOrThrow } from "@lib/asStringOrNull";
import prisma from "@lib/prisma";
import { DisposableBookingObject } from "@lib/types/booking";
import { inferSSRProps } from "@lib/types/inferSSRProps";

import BookingPage from "@components/booking/pages/BookingPage";

import { getTranslation } from "@server/lib/i18n";
import { ssrInit } from "@server/lib/ssr";

dayjs.extend(utc);
dayjs.extend(timezone);

export type BookPageProps = inferSSRProps<typeof getServerSideProps>;

export default function Book(props: BookPageProps) {
  return <BookingPage {...props} />;
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const ssr = await ssrInit(context);
  const link = asStringOrThrow(context.query.link as string);
  const slug = context.query.slug as string;

  const eventTypeSelect = Prisma.validator<Prisma.EventTypeSelect>()({
    id: true,
    title: true,
    slug: true,
    description: true,
    length: true,
    locations: true,
    customInputs: true,
    periodType: true,
    periodDays: true,
    periodStartDate: true,
    periodEndDate: true,
    metadata: true,
    periodCountCalendarDays: true,
    price: true,
    currency: true,
    disableGuests: true,
    userId: true,
    users: {
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        bio: true,
        avatar: true,
        theme: true,
      },
    },
  });

  const disposableType = await prisma.disposableLink.findUnique({
    where: {
      link_slug: {
        link,
        slug,
      },
    },
    select: {
      users: {
        select: {
          id: true,
          avatar: true,
          name: true,
          username: true,
          hideBranding: true,
          plan: true,
          timeZone: true,
        },
      },
      userId: true,
      eventType: {
        select: eventTypeSelect,
      },
      availability: true,
      timeZone: true,
      expired: true,
    },
  });
  // Handle expired links here
  const linkExpired = disposableType?.expired;
  if (linkExpired) {
    return {
      notFound: true,
    };
  }

  const userId = disposableType?.userId || disposableType?.eventType.userId;

  if (!userId)
    return {
      notFound: true,
    };

  const users = await prisma.user.findMany({
    where: {
      id: userId,
    },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      bio: true,
      avatar: true,
      theme: true,
      brandColor: true,
      darkBrandColor: true,
      allowDynamicBooking: true,
    },
  });

  if (!users.length) return { notFound: true };
  const [user] = users;
  const eventTypeRaw = disposableType?.eventType;

  if (!eventTypeRaw) return { notFound: true };

  const credentials = await prisma.credential.findMany({
    where: {
      userId: {
        in: users.map((user) => user.id),
      },
    },
    select: {
      id: true,
      type: true,
      key: true,
    },
  });

  const web3Credentials = credentials.find((credential) => credential.type.includes("_web3"));

  const eventType = {
    ...eventTypeRaw,
    metadata: (eventTypeRaw.metadata || {}) as JSONObject,
    isWeb3Active:
      web3Credentials && web3Credentials.key
        ? (((web3Credentials.key as JSONObject).isWeb3Active || false) as boolean)
        : false,
  };

  const eventTypeObject = [eventType].map((e) => {
    return {
      ...e,
      periodStartDate: e.periodStartDate?.toString() ?? null,
      periodEndDate: e.periodEndDate?.toString() ?? null,
    };
  })[0];

  async function getBooking() {
    return prisma.booking.findFirst({
      where: {
        uid: asStringOrThrow(context.query.rescheduleUid),
      },
      select: {
        description: true,
        attendees: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });
  }
  const disposableBookingObject: DisposableBookingObject = {
    slug,
    link,
  };

  type Booking = Prisma.PromiseReturnType<typeof getBooking>;
  let booking: Booking | null = null;

  const profile = {
    name: user.name || user.username,
    image: user.avatar,
    slug: user.username,
    theme: user.theme,
    brandColor: user.brandColor,
    darkBrandColor: user.darkBrandColor,
    eventName: null,
  };

  const t = await getTranslation(context.locale ?? "en", "common");

  return {
    props: {
      locationLabels: getLocationLabels(t),
      profile,
      eventType: eventTypeObject,
      booking,
      trpcState: ssr.dehydrate(),
      isDynamicGroupBooking: false,
      isDisposableBookingLink: true,
      disposableBookingObject,
    },
  };
}