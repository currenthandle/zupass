import {
  EdDSAPublicKey,
  getEdDSAPublicKey,
  isEqualEdDSAPublicKey
} from "@pcd/eddsa-pcd";
import {
  EdDSATicketPCD,
  EdDSATicketPCDPackage,
  ITicketData,
  TicketCategory,
  getEdDSATicketData
} from "@pcd/eddsa-ticket-pcd";
import { EmailPCD, EmailPCDPackage } from "@pcd/email-pcd";
import { getHash } from "@pcd/passport-crypto";
import {
  CheckTicketByIdRequest,
  CheckTicketByIdResult,
  CheckTicketInByIdRequest,
  CheckTicketInByIdResult,
  CheckTicketInRequest,
  CheckTicketInResult,
  CheckTicketRequest,
  CheckTicketResult,
  FeedHost,
  ISSUANCE_STRING,
  KnownPublicKeyType,
  KnownTicketGroup,
  KnownTicketTypesResult,
  ListFeedsRequest,
  ListFeedsResponseValue,
  ListSingleFeedRequest,
  PollFeedRequest,
  PollFeedResponseValue,
  VerifyTicketRequest,
  VerifyTicketResult,
  ZupassFeedIds,
  ZuzaluUserRole,
  verifyFeedCredential,
  zupassDefaultSubscriptions
} from "@pcd/passport-interface";
import {
  AppendToFolderAction,
  AppendToFolderPermission,
  DeleteFolderAction,
  PCDAction,
  PCDActionType,
  PCDPermissionType,
  ReplaceInFolderAction,
  joinPath
} from "@pcd/pcd-collection";
import { ArgumentTypeName, SerializedPCD } from "@pcd/pcd-types";
import { RSAImagePCDPackage } from "@pcd/rsa-image-pcd";
import {
  SemaphoreSignaturePCD,
  SemaphoreSignaturePCDPackage
} from "@pcd/semaphore-signature-pcd";
import { getErrorMessage } from "@pcd/util";
import _ from "lodash";
import { LRUCache } from "lru-cache";
import NodeRSA from "node-rsa";
import { Pool } from "postgres-pool";
import {
  DevconnectPretixTicketDBWithEmailAndItem,
  UserRow
} from "../database/models";
import {
  fetchDevconnectPretixTicketByTicketId,
  fetchDevconnectPretixTicketsByEmail,
  fetchDevconnectSuperusersForEmail
} from "../database/queries/devconnect_pretix_tickets/fetchDevconnectPretixTicket";
import { consumeDevconnectPretixTicket } from "../database/queries/devconnect_pretix_tickets/updateDevconnectPretixTicket";
import {
  fetchKnownPublicKeys,
  fetchKnownTicketByEventAndProductId,
  fetchKnownTicketTypes,
  setKnownPublicKey,
  setKnownTicketType
} from "../database/queries/knownTicketTypes";
import { fetchUserByCommitment } from "../database/queries/users";
import { fetchZuconnectTicketsByEmail } from "../database/queries/zuconnect/fetchZuconnectTickets";
import { fetchLoggedInZuzaluUser } from "../database/queries/zuzalu_pretix_tickets/fetchZuzaluUser";
import { PCDHTTPError } from "../routing/pcdHttpError";
import { ApplicationContext } from "../types";
import { logger } from "../util/logger";
import { timeBasedId } from "../util/timeBasedId";
import {
  ZUCONNECT_PRODUCT_ID_MAPPINGS,
  zuconnectProductIdToName
} from "../util/zuconnectTicket";
import { MultiProcessService } from "./multiProcessService";
import { PersistentCacheService } from "./persistentCacheService";
import { RollbarService } from "./rollbarService";
import { traced } from "./telemetryService";

export const ZUPASS_TICKET_PUBLIC_KEY_NAME = "Zupass";

// Since Zuzalu did not have event or product UUIDs at the time, we can
// allocate some constant ones now.
export const ZUZALU_23_RESIDENT_PRODUCT_ID =
  "5ba4cd9e-893c-4a4a-b15b-cf36ceda1938";
export const ZUZALU_23_VISITOR_PRODUCT_ID =
  "53b518ed-e427-4a23-bf36-a6e1e2764256";
export const ZUZALU_23_ORGANIZER_PRODUCT_ID =
  "10016d35-40df-4033-a171-7d661ebaccaa";
export const ZUZALU_23_EVENT_ID = "5de90d09-22db-40ca-b3ae-d934573def8b";
export const ZUCONNECT_23_EVENT_ID = "91312aa1-5f74-4264-bdeb-f4a3ddb8670c";
// Zuconnect product IDs are defined in src/util/zuconnectTicket.ts

export class IssuanceService {
  private readonly context: ApplicationContext;
  private readonly cacheService: PersistentCacheService;
  private readonly rollbarService: RollbarService | null;
  private readonly feedHost: FeedHost;
  private readonly eddsaPrivateKey: string;
  private readonly rsaPrivateKey: NodeRSA;
  private readonly exportedRSAPrivateKey: string;
  private readonly exportedRSAPublicKey: string;
  private readonly multiprocessService: MultiProcessService;
  private readonly verificationPromiseCache: LRUCache<string, Promise<boolean>>;

  public constructor(
    context: ApplicationContext,
    cacheService: PersistentCacheService,
    multiprocessService: MultiProcessService,
    rollbarService: RollbarService | null,
    rsaPrivateKey: NodeRSA,
    eddsaPrivateKey: string
  ) {
    this.context = context;
    this.cacheService = cacheService;
    this.multiprocessService = multiprocessService;
    this.rollbarService = rollbarService;
    this.rsaPrivateKey = rsaPrivateKey;
    this.exportedRSAPrivateKey = this.rsaPrivateKey.exportKey("private");
    this.exportedRSAPublicKey = this.rsaPrivateKey.exportKey("public");
    this.eddsaPrivateKey = eddsaPrivateKey;
    const FEED_PROVIDER_NAME = "Zupass";
    this.verificationPromiseCache = new LRUCache<string, Promise<boolean>>({
      max: 1000
    });

    this.feedHost = new FeedHost(
      [
        {
          handleRequest: async (
            req: PollFeedRequest
          ): Promise<PollFeedResponseValue> => {
            const actions = [];

            try {
              if (req.pcd === undefined) {
                throw new Error(`Missing credential`);
              }
              const { pcd } = await verifyFeedCredential(
                req.pcd,
                this.cachedVerifySignaturePCD.bind(this)
              );
              const pcds = await this.issueDevconnectPretixTicketPCDs(pcd);
              const ticketsByEvent = _.groupBy(
                pcds,
                (pcd) => pcd.claim.ticket.eventName
              );

              const devconnectTickets = Object.entries(ticketsByEvent).filter(
                ([eventName]) => eventName !== "SBC SRW"
              );

              const srwTickets = Object.entries(ticketsByEvent).filter(
                ([eventName]) => eventName === "SBC SRW"
              );

              actions.push({
                type: PCDActionType.DeleteFolder,
                folder: "SBC SRW",
                recursive: false
              });

              actions.push({
                type: PCDActionType.DeleteFolder,
                folder: "Devconnect",
                recursive: true
              });

              actions.push(
                ...(
                  await Promise.all(
                    devconnectTickets.map(async ([eventName, tickets]) => [
                      {
                        type: PCDActionType.ReplaceInFolder,
                        folder: joinPath("Devconnect", eventName),
                        pcds: await Promise.all(
                          tickets.map((pcd) =>
                            EdDSATicketPCDPackage.serialize(pcd)
                          )
                        )
                      }
                    ])
                  )
                ).flat()
              );

              actions.push(
                ...(await Promise.all(
                  srwTickets.map(async ([_, tickets]) => ({
                    type: PCDActionType.ReplaceInFolder,
                    folder: "SBC SRW",
                    pcds: await Promise.all(
                      tickets.map((pcd) => EdDSATicketPCDPackage.serialize(pcd))
                    )
                  }))
                ))
              );
            } catch (e) {
              logger(`Error encountered while serving feed:`, e);
              this.rollbarService?.reportError(e);
            }

            return { actions };
          },
          feed: zupassDefaultSubscriptions[ZupassFeedIds.Devconnect]
        },
        {
          handleRequest: async (
            req: PollFeedRequest
          ): Promise<PollFeedResponseValue> => {
            try {
              if (req.pcd === undefined) {
                throw new Error(`Missing credential`);
              }
              await verifyFeedCredential(
                req.pcd,
                this.cachedVerifySignaturePCD.bind(this)
              );
              return {
                actions: [
                  {
                    pcds: await this.issueFrogPCDs(),
                    folder: "Frogs",
                    type: PCDActionType.AppendToFolder
                  } as AppendToFolderAction
                ]
              };
            } catch (e) {
              logger(`Error encountered while serving feed:`, e);
              this.rollbarService?.reportError(e);
            }
            return { actions: [] };
          },
          feed: {
            id: ZupassFeedIds.Frogs,
            name: "Frogs",
            description: "Get your Frogs here!",
            inputPCDType: undefined,
            partialArgs: undefined,
            credentialRequest: {
              signatureType: "sempahore-signature-pcd"
            },
            permissions: [
              {
                folder: "Frogs",
                type: PCDPermissionType.AppendToFolder
              } as AppendToFolderPermission
            ]
          }
        },
        {
          handleRequest: async (
            req: PollFeedRequest
          ): Promise<PollFeedResponseValue> => {
            const actions: PCDAction[] = [];

            try {
              if (req.pcd === undefined) {
                throw new Error(`Missing credential`);
              }
              const { pcd } = await verifyFeedCredential(
                req.pcd,
                this.cachedVerifySignaturePCD.bind(this)
              );
              const pcds = await this.issueEmailPCDs(pcd);

              // Clear out the folder
              actions.push({
                type: PCDActionType.DeleteFolder,
                folder: "Email",
                recursive: false
              } as DeleteFolderAction);

              actions.push({
                type: PCDActionType.ReplaceInFolder,
                folder: "Email",
                pcds: await Promise.all(
                  pcds.map((pcd) => EmailPCDPackage.serialize(pcd))
                )
              } as ReplaceInFolderAction);
            } catch (e) {
              logger(`Error encountered while serving feed:`, e);
              this.rollbarService?.reportError(e);
            }

            return { actions };
          },
          feed: zupassDefaultSubscriptions[ZupassFeedIds.Email]
        },
        {
          handleRequest: async (
            req: PollFeedRequest
          ): Promise<PollFeedResponseValue> => {
            const actions: PCDAction[] = [];
            if (req.pcd === undefined) {
              throw new Error(`Missing credential`);
            }
            try {
              const { pcd } = await verifyFeedCredential(
                req.pcd,
                this.cachedVerifySignaturePCD.bind(this)
              );
              const pcds = await this.issueZuzaluTicketPCDs(pcd);

              // Clear out the folder
              actions.push({
                type: PCDActionType.DeleteFolder,
                folder: "Zuzalu '23",
                recursive: false
              } as DeleteFolderAction);

              actions.push({
                type: PCDActionType.ReplaceInFolder,
                folder: "Zuzalu '23",
                pcds: await Promise.all(
                  pcds.map((pcd) => EdDSATicketPCDPackage.serialize(pcd))
                )
              } as ReplaceInFolderAction);
            } catch (e) {
              logger(`Error encountered while serving feed:`, e);
              this.rollbarService?.reportError(e);
            }

            return { actions };
          },
          feed: zupassDefaultSubscriptions[ZupassFeedIds.Zuzalu_23]
        },
        {
          handleRequest: async (
            req: PollFeedRequest
          ): Promise<PollFeedResponseValue> => {
            const actions: PCDAction[] = [];
            if (req.pcd === undefined) {
              throw new Error(`Missing credential`);
            }
            try {
              const { pcd } = await verifyFeedCredential(
                req.pcd,
                this.cachedVerifySignaturePCD.bind(this)
              );

              const pcds = await this.issueZuconnectTicketPCDs(pcd);

              // Clear out the folder
              actions.push({
                type: PCDActionType.DeleteFolder,
                folder: "Zuconnect",
                recursive: false
              } as DeleteFolderAction);

              actions.push({
                type: PCDActionType.ReplaceInFolder,
                folder: "Zuconnect",
                pcds: await Promise.all(
                  pcds.map((pcd) => EdDSATicketPCDPackage.serialize(pcd))
                )
              } as ReplaceInFolderAction);
            } catch (e) {
              logger(`Error encountered while serving feed:`, e);
              this.rollbarService?.reportError(e);
            }

            return { actions };
          },
          feed: zupassDefaultSubscriptions[ZupassFeedIds.Zuconnect_23]
        }
      ],
      `${process.env.PASSPORT_SERVER_URL}/feeds`,
      FEED_PROVIDER_NAME
    );
  }

  public async handleListFeedsRequest(
    request: ListFeedsRequest
  ): Promise<ListFeedsResponseValue> {
    return this.feedHost.handleListFeedsRequest(request);
  }

  public async handleListSingleFeedRequest(
    request: ListSingleFeedRequest
  ): Promise<ListFeedsResponseValue> {
    return this.feedHost.handleListSingleFeedRequest(request);
  }

  public async handleFeedRequest(
    request: PollFeedRequest
  ): Promise<PollFeedResponseValue> {
    return this.feedHost.handleFeedRequest(request);
  }

  public hasFeedWithId(feedId: string): boolean {
    return this.feedHost.hasFeedWithId(feedId);
  }

  public getRSAPublicKey(): string {
    return this.exportedRSAPublicKey;
  }

  public getEdDSAPublicKey(): Promise<EdDSAPublicKey> {
    return getEdDSAPublicKey(this.eddsaPrivateKey);
  }

  public async handleDevconnectCheckInRequest(
    request: CheckTicketInRequest
  ): Promise<CheckTicketInResult> {
    try {
      const ticketPCD = await EdDSATicketPCDPackage.deserialize(
        request.ticket.pcd
      );

      const ticketValid = await this.checkDevconnectTicket(ticketPCD);

      if (ticketValid.error != null) {
        return ticketValid;
      }

      const ticketData = getEdDSATicketData(ticketPCD);

      if (!ticketData) {
        return {
          error: { name: "InvalidTicket" },
          success: false
        };
      }

      const signature = await SemaphoreSignaturePCDPackage.deserialize(
        request.checkerProof.pcd
      );

      if (
        !(await SemaphoreSignaturePCDPackage.verify(signature)) ||
        signature.claim.signedMessage !== ISSUANCE_STRING
      ) {
        return {
          error: { name: "NotSuperuser" },
          success: false
        };
      }

      const checker = await this.checkUserExists(signature);

      if (!checker) {
        return {
          error: { name: "NotSuperuser" },
          success: false
        };
      }

      const checkerSuperUserPermissions =
        await fetchDevconnectSuperusersForEmail(
          this.context.dbPool,
          checker.email
        );

      const relevantSuperUserPermission = checkerSuperUserPermissions.find(
        (perm) => perm.pretix_events_config_id === ticketData.eventId
      );

      if (!relevantSuperUserPermission) {
        return { error: { name: "NotSuperuser" }, success: false };
      }

      const successfullyConsumed = await consumeDevconnectPretixTicket(
        this.context.dbPool,
        ticketData.ticketId,
        checker.email
      );

      if (successfullyConsumed) {
        return {
          value: undefined,
          success: true
        };
      }

      return {
        error: { name: "ServerError" },
        success: false
      };
    } catch (e) {
      logger("Error when consuming devconnect ticket", { error: e });
      throw new PCDHTTPError(500, "failed to check in", { cause: e });
    }
  }

  public async handleDevconnectCheckInByIdRequest(
    request: CheckTicketInByIdRequest
  ): Promise<CheckTicketInByIdResult> {
    try {
      const ticketDB = await fetchDevconnectPretixTicketByTicketId(
        this.context.dbPool,
        request.ticketId
      );

      if (!ticketDB) {
        return {
          error: { name: "InvalidTicket" },
          success: false
        };
      }

      const ticketData = {
        ticketId: request.ticketId,
        eventId: ticketDB?.pretix_events_config_id
      };

      const verified = await this.cachedVerifySignaturePCD(
        request.checkerProof
      );
      if (!verified) {
        return {
          error: { name: "InvalidSignature" },
          success: false
        };
      }

      const checker = await this.checkUserExists(
        await SemaphoreSignaturePCDPackage.deserialize(request.checkerProof.pcd)
      );

      if (!checker) {
        return {
          error: { name: "NotSuperuser" },
          success: false
        };
      }

      const checkerSuperUserPermissions =
        await fetchDevconnectSuperusersForEmail(
          this.context.dbPool,
          checker.email
        );

      const relevantSuperUserPermission = checkerSuperUserPermissions.find(
        (perm) => perm.pretix_events_config_id === ticketData.eventId
      );

      if (!relevantSuperUserPermission) {
        return { error: { name: "NotSuperuser" }, success: false };
      }

      const successfullyConsumed = await consumeDevconnectPretixTicket(
        this.context.dbPool,
        ticketData.ticketId ?? "",
        checker.email
      );

      if (successfullyConsumed) {
        return {
          value: undefined,
          success: true
        };
      }

      return {
        error: { name: "ServerError" },
        success: false
      };
    } catch (e) {
      logger("Error when consuming devconnect ticket", { error: e });
      throw new PCDHTTPError(500, "failed to check in", { cause: e });
    }
  }

  /**
   * Check that a ticket is valid for Devconnect-only check-in by validating
   * the PCD and checking that the ticket is in the DB and is not deleted,
   * consumed etc.
   */
  public async handleDevconnectCheckTicketRequest(
    request: CheckTicketRequest
  ): Promise<CheckTicketResult> {
    try {
      const ticketPCD = await EdDSATicketPCDPackage.deserialize(
        request.ticket.pcd
      );
      return this.checkDevconnectTicket(ticketPCD);
    } catch (e) {
      return {
        error: { name: "ServerError" },
        success: false
      };
    }
  }

  /**
   * Validates an EdDSATicketPCD for Devconnect check-in by checking the
   * PCD's attributes and the status of the ticket in the DB.
   */
  public async checkDevconnectTicket(
    ticketPCD: EdDSATicketPCD
  ): Promise<CheckTicketResult> {
    try {
      const proofPublicKey = ticketPCD.proof.eddsaPCD.claim.publicKey;
      if (!proofPublicKey) {
        return {
          error: {
            name: "InvalidSignature",
            detailedMessage: "Ticket malformed: missing public key."
          },
          success: false
        };
      }

      const serverPublicKey = await this.getEdDSAPublicKey();
      if (!isEqualEdDSAPublicKey(serverPublicKey, proofPublicKey)) {
        return {
          error: {
            name: "InvalidSignature",
            detailedMessage: "This ticket was not signed by Zupass."
          },
          success: false
        };
      }

      const ticket = getEdDSATicketData(ticketPCD);

      if (!ticket || !ticket.ticketId) {
        return {
          error: {
            name: "InvalidTicket",
            detailedMessage: "Ticket malformed: missing data."
          },
          success: false
        };
      }

      const ticketInDb = await fetchDevconnectPretixTicketByTicketId(
        this.context.dbPool,
        ticket.ticketId
      );

      if (!ticketInDb) {
        return {
          error: {
            name: "InvalidTicket",
            detailedMessage: "Ticket does not exist on backend."
          },
          success: false
        };
      }

      if (ticketInDb.is_deleted) {
        return {
          error: { name: "TicketRevoked", revokedTimestamp: Date.now() },
          success: false
        };
      }

      if (ticketInDb.is_consumed) {
        return {
          error: {
            name: "AlreadyCheckedIn",
            checker: ticketInDb.checker ?? undefined,
            checkinTimestamp: (
              ticketInDb.zupass_checkin_timestamp ?? new Date()
            ).toISOString()
          },
          success: false
        };
      }

      return { value: undefined, success: true };
    } catch (e) {
      logger("Error when checking ticket", { error: e });
      return {
        error: { name: "ServerError", detailedMessage: getErrorMessage(e) },
        success: false
      };
    }
  }

  /**
   * Checks that a ticket is valid for Devconnect check-in based on the ticket
   * data in the DB.
   */
  public async handleDevconnectCheckTicketByIdRequest(
    request: CheckTicketByIdRequest
  ): Promise<CheckTicketByIdResult> {
    try {
      return this.checkDevconnectTicketById(request.ticketId);
    } catch (e) {
      return {
        error: { name: "ServerError" },
        success: false
      };
    }
  }

  /**
   * Checks a ticket for validity based on the ticket's status in the DB.
   */
  public async checkDevconnectTicketById(
    ticketId: string
  ): Promise<CheckTicketByIdResult> {
    try {
      const ticketInDb = await fetchDevconnectPretixTicketByTicketId(
        this.context.dbPool,
        ticketId
      );

      if (!ticketInDb) {
        return {
          error: {
            name: "InvalidTicket",
            detailedMessage: "Ticket does not exist on backend."
          },
          success: false
        };
      }

      if (ticketInDb.is_deleted) {
        return {
          error: { name: "TicketRevoked", revokedTimestamp: Date.now() },
          success: false
        };
      }

      if (ticketInDb.is_consumed) {
        return {
          error: {
            name: "AlreadyCheckedIn",
            checker: ticketInDb.checker ?? undefined,
            checkinTimestamp: (
              ticketInDb.zupass_checkin_timestamp ?? new Date()
            ).toISOString()
          },
          success: false
        };
      }

      return {
        value: {
          eventName: ticketInDb.event_name,
          attendeeEmail: ticketInDb.email,
          attendeeName: ticketInDb.full_name,
          ticketName: ticketInDb.item_name
        },
        success: true
      };
    } catch (e) {
      logger("Error when checking ticket", { error: e });
      return {
        error: { name: "ServerError", detailedMessage: getErrorMessage(e) },
        success: false
      };
    }
  }

  private async checkUserExists(
    signature: SemaphoreSignaturePCD
  ): Promise<UserRow | null> {
    const user = await fetchUserByCommitment(
      this.context.dbPool,
      signature.claim.identityCommitment
    );

    if (user == null) {
      logger(
        `can't issue PCDs for ${signature.claim.identityCommitment} because ` +
          `we don't have a user with that commitment in the database`
      );
      return null;
    }

    return user;
  }

  /**
   * Fetch all DevconnectPretixTicket entities under a given user's email.
   */
  private async issueDevconnectPretixTicketPCDs(
    credential: SemaphoreSignaturePCD
  ): Promise<EdDSATicketPCD[]> {
    return traced(
      "IssuanceService",
      "issueDevconnectPretixTicketPCDs",
      async (span) => {
        const commitmentRow = await this.checkUserExists(credential);
        const email = commitmentRow?.email;
        if (commitmentRow) {
          span?.setAttribute(
            "commitment",
            commitmentRow?.commitment?.toString() ?? ""
          );
        }
        if (email) {
          span?.setAttribute("email", email);
        }

        if (commitmentRow == null || email == null) {
          return [];
        }

        const commitmentId = commitmentRow.commitment.toString();
        const ticketsDB = await fetchDevconnectPretixTicketsByEmail(
          this.context.dbPool,
          email
        );

        const tickets = await Promise.all(
          ticketsDB
            .map((t) => IssuanceService.ticketRowToTicketData(t, commitmentId))
            .map((ticketData) => this.getOrGenerateTicket(ticketData))
        );

        span?.setAttribute("ticket_count", tickets.length);

        return tickets;
      }
    );
  }

  private async getOrGenerateTicket(
    ticketData: ITicketData
  ): Promise<EdDSATicketPCD> {
    return traced("IssuanceService", "getOrGenerateTicket", async (span) => {
      span?.setAttribute("ticket_id", ticketData.ticketId);
      span?.setAttribute("ticket_email", ticketData.attendeeEmail);
      span?.setAttribute("ticket_name", ticketData.attendeeName);

      const cachedTicket = await this.getCachedTicket(ticketData);

      if (cachedTicket) {
        return cachedTicket;
      }

      logger(`[ISSUANCE] cache miss for ticket id ${ticketData.ticketId}`);

      const generatedTicket = await IssuanceService.ticketDataToTicketPCD(
        ticketData,
        this.eddsaPrivateKey
      );

      try {
        this.cacheTicket(generatedTicket);
      } catch (e) {
        this.rollbarService?.reportError(e);
        logger(
          `[ISSUANCE] error caching ticket ${ticketData.ticketId} ` +
            `${ticketData.attendeeEmail} for ${ticketData.eventId} (${ticketData.eventName})`
        );
      }

      return generatedTicket;
    });
  }

  private static async getTicketCacheKey(
    ticketData: ITicketData
  ): Promise<string> {
    const ticketCopy: any = { ...ticketData };
    // the reason we remove `timestampSigned` from the cache key
    // is that it changes every time we instantiate `ITicketData`
    // for a particular devconnect ticket, rendering the caching
    // ineffective.
    delete ticketCopy.timestampSigned;
    const hash = await getHash(JSON.stringify(ticketCopy));
    return hash;
  }

  private async cacheTicket(ticket: EdDSATicketPCD): Promise<void> {
    const key = await IssuanceService.getTicketCacheKey(ticket.claim.ticket);
    const serialized = await EdDSATicketPCDPackage.serialize(ticket);
    this.cacheService.setValue(key, JSON.stringify(serialized));
  }

  private async getCachedTicket(
    ticketData: ITicketData
  ): Promise<EdDSATicketPCD | undefined> {
    const key = await IssuanceService.getTicketCacheKey(ticketData);
    const serializedTicket = await this.cacheService.getValue(key);
    if (!serializedTicket) {
      logger(`[ISSUANCE] cache miss for ticket id ${ticketData.ticketId}`);
      return undefined;
    }
    logger(`[ISSUANCE] cache hit for ticket id ${ticketData.ticketId}`);
    const parsedTicket = JSON.parse(serializedTicket.cache_value);

    try {
      const deserializedTicket = await EdDSATicketPCDPackage.deserialize(
        parsedTicket.pcd
      );
      return deserializedTicket;
    } catch (e) {
      logger("[ISSUANCE]", `failed to parse cached ticket ${key}`, e);
      this.rollbarService?.reportError(e);
      return undefined;
    }
  }

  private static async ticketDataToTicketPCD(
    ticketData: ITicketData,
    eddsaPrivateKey: string
  ): Promise<EdDSATicketPCD> {
    const stableId = await getHash("issued-ticket-" + ticketData.ticketId);

    const ticketPCD = await EdDSATicketPCDPackage.prove({
      ticket: {
        value: ticketData,
        argumentType: ArgumentTypeName.Object
      },
      privateKey: {
        value: eddsaPrivateKey,
        argumentType: ArgumentTypeName.String
      },
      id: {
        value: stableId,
        argumentType: ArgumentTypeName.String
      }
    });

    return ticketPCD;
  }

  private static ticketRowToTicketData(
    t: DevconnectPretixTicketDBWithEmailAndItem,
    semaphoreId: string
  ): ITicketData {
    return {
      // unsigned fields
      attendeeName: t.full_name,
      attendeeEmail: t.email,
      eventName: t.event_name,
      ticketName: t.item_name,
      checkerEmail: t.checker ?? undefined,

      // signed fields
      ticketId: t.id,
      eventId: t.pretix_events_config_id,
      productId: t.devconnect_pretix_items_info_id,
      timestampConsumed:
        t.zupass_checkin_timestamp == null
          ? 0
          : new Date(t.zupass_checkin_timestamp).getTime(),
      timestampSigned: Date.now(),
      attendeeSemaphoreId: semaphoreId,
      isConsumed: t.is_consumed,
      isRevoked: t.is_deleted,
      ticketCategory: TicketCategory.Devconnect
    } satisfies ITicketData;
  }

  private async issueFrogPCDs(): Promise<SerializedPCD[]> {
    const FROG_INTERVAL_MS = 1000 * 60 * 10; // one new frog every ten minutes
    const serverUrl = process.env.PASSPORT_CLIENT_URL;

    if (!serverUrl) {
      logger("[ISSUE] can't issue frogs - unaware of the client location");
      return [];
    }

    const frogPaths: string[] = [
      "images/frogs/frog.jpeg",
      "images/frogs/frog2.jpeg",
      "images/frogs/frog3.jpeg",
      "images/frogs/frog4.jpeg"
    ];

    const randomFrogPath = _.sample(frogPaths);

    const id = timeBasedId(FROG_INTERVAL_MS) + "";

    const frogPCD = await RSAImagePCDPackage.serialize(
      await RSAImagePCDPackage.prove({
        privateKey: {
          argumentType: ArgumentTypeName.String,
          value: this.exportedRSAPrivateKey
        },
        url: {
          argumentType: ArgumentTypeName.String,
          value: serverUrl + "/" + randomFrogPath
        },
        title: {
          argumentType: ArgumentTypeName.String,
          value: "frog " + id
        },
        id: {
          argumentType: ArgumentTypeName.String,
          value: id
        }
      })
    );

    return [frogPCD];
  }

  /**
   * Issues email PCDs based on the user's verified email address.
   * Currently we only verify a single email address, but could provide
   * multiple PCDs if it were possible to verify secondary emails.
   */
  private async issueEmailPCDs(
    credential: SemaphoreSignaturePCD
  ): Promise<EmailPCD[]> {
    return traced(
      "IssuanceService",
      "issueDevconnectPretixTicketPCDs",
      async (span) => {
        const commitmentRow = await this.checkUserExists(credential);
        const email = commitmentRow?.email;
        if (commitmentRow) {
          span?.setAttribute(
            "commitment",
            commitmentRow?.commitment?.toString() ?? ""
          );
        }
        if (email) {
          span?.setAttribute("email", email);
        }

        if (commitmentRow == null || email == null) {
          return [];
        }

        const stableId = "attested-email-" + email;

        return [
          await EmailPCDPackage.prove({
            privateKey: {
              value: this.eddsaPrivateKey,
              argumentType: ArgumentTypeName.String
            },
            id: {
              value: stableId,
              argumentType: ArgumentTypeName.String
            },
            emailAddress: {
              value: email,
              argumentType: ArgumentTypeName.String
            },
            semaphoreId: {
              value: commitmentRow.commitment,
              argumentType: ArgumentTypeName.String
            }
          })
        ];
      }
    );
  }

  private async issueZuzaluTicketPCDs(
    credential: SemaphoreSignaturePCD
  ): Promise<EdDSATicketPCD[]> {
    return traced("IssuanceService", "issueZuzaluTicketPCDs", async (span) => {
      const commitmentRow = await this.checkUserExists(credential);
      const email = commitmentRow?.email;
      if (commitmentRow) {
        span?.setAttribute(
          "commitment",
          commitmentRow?.commitment?.toString() ?? ""
        );
      }
      if (email) {
        span?.setAttribute("email", email);
      }

      if (commitmentRow == null || email == null) {
        return [];
      }

      const user = await fetchLoggedInZuzaluUser(this.context.dbPool, {
        uuid: commitmentRow.uuid
      });

      const tickets = [];

      if (user) {
        tickets.push(
          await this.getOrGenerateTicket({
            attendeeSemaphoreId: user.commitment,
            eventName: "Zuzalu (March - May 2023)",
            checkerEmail: undefined,
            ticketId: user.uuid,
            ticketName: user.role.toString(),
            attendeeName: user.name,
            attendeeEmail: user.email,
            eventId: ZUZALU_23_EVENT_ID,
            productId:
              user.role === ZuzaluUserRole.Visitor
                ? ZUZALU_23_VISITOR_PRODUCT_ID
                : user.role === ZuzaluUserRole.Organizer
                ? ZUZALU_23_ORGANIZER_PRODUCT_ID
                : ZUZALU_23_RESIDENT_PRODUCT_ID,
            timestampSigned: Date.now(),
            timestampConsumed: 0,
            isConsumed: false,
            isRevoked: false,
            ticketCategory: TicketCategory.Zuzalu
          })
        );
      }

      return tickets;
    });
  }

  /**
   * Issues EdDSATicketPCD tickets to Zuconnect ticket holders.
   * It is technically possible for a user to have more than one ticket, e.g.
   * a day pass ticket-holder might upgrade to a full ticket.
   */
  private async issueZuconnectTicketPCDs(
    credential: SemaphoreSignaturePCD
  ): Promise<EdDSATicketPCD[]> {
    return traced(
      "IssuanceService",
      "issueZuconnectTicketPCDs",
      async (span) => {
        const user = await this.checkUserExists(credential);
        const email = user?.email;
        if (user) {
          span?.setAttribute("commitment", user?.commitment?.toString() ?? "");
        }
        if (email) {
          span?.setAttribute("email", email);
        }

        if (user == null || email == null) {
          return [];
        }

        const tickets = await fetchZuconnectTicketsByEmail(
          this.context.dbPool,
          email
        );

        const pcds = [];

        for (const ticket of tickets) {
          pcds.push(
            await this.getOrGenerateTicket({
              attendeeSemaphoreId: user.commitment,
              eventName: "Zuconnect October-November '23",
              checkerEmail: undefined,
              ticketId: ticket.id,
              ticketName: zuconnectProductIdToName(ticket.product_id),
              attendeeName: `${ticket.attendee_name}`,
              attendeeEmail: ticket.attendee_email,
              eventId: ZUCONNECT_23_EVENT_ID,
              productId: ticket.product_id,
              timestampSigned: Date.now(),
              timestampConsumed: 0,
              isConsumed: false,
              isRevoked: false,
              ticketCategory: TicketCategory.ZuConnect
            })
          );
        }

        return pcds;
      }
    );
  }

  /**
   * Returns a promised verification of a PCD, either from the cache or,
   * if there is no cache entry, from the multiprocess service.
   */
  private async cachedVerifySignaturePCD(
    serializedPCD: SerializedPCD<SemaphoreSignaturePCD>
  ): Promise<boolean> {
    const key = JSON.stringify(serializedPCD);
    const cached = this.verificationPromiseCache.get(key);
    if (cached) {
      return cached;
    } else {
      const deserialized = await SemaphoreSignaturePCDPackage.deserialize(
        serializedPCD.pcd
      );
      const promise = SemaphoreSignaturePCDPackage.verify(deserialized);
      this.verificationPromiseCache.set(key, promise);
      // If the promise rejects, delete it from the cache
      promise.catch(() => this.verificationPromiseCache.delete(key));
      return promise;
    }
  }

  /**
   * Verifies a ticket based on:
   * 1) verification of the PCD (that it is correctly formed, with a proof
   *    matching the claim)
   * 2) whether the ticket matches the ticket types known to us, e.g. Zuzalu
   *    or Zuconnect tickets
   *
   * Not used for Devconnect tickets, which have a separate check-in flow.
   * This is the default verification flow for ticket PCDs, based on the
   * standard QR code, but only Zuconnect/Zuzalu '23 tickets will be returned
   * as verified.
   */
  private async verifyZuconnect23OrZuzalu23Ticket(
    serializedPCD: SerializedPCD
  ): Promise<VerifyTicketResult> {
    if (!serializedPCD.type) {
      throw new Error("input was not a serialized PCD");
    }

    if (serializedPCD.type !== EdDSATicketPCDPackage.name) {
      throw new Error(
        `serialized PCD was wrong type, '${serializedPCD.type}' instead of '${EdDSATicketPCDPackage.name}'`
      );
    }

    await EdDSATicketPCDPackage.init?.({});

    const pcd = await EdDSATicketPCDPackage.deserialize(serializedPCD.pcd);

    if (!EdDSATicketPCDPackage.verify(pcd)) {
      return {
        success: true,
        value: { verified: false, message: "Could not verify PCD." }
      };
    }

    // PCD has verified, let's see if it's a known ticket
    const ticket = pcd.claim.ticket;
    const knownTicketType = await fetchKnownTicketByEventAndProductId(
      this.context.dbPool,
      ticket.eventId,
      ticket.productId
    );

    // If we found a known ticket type, compare public keys
    if (
      knownTicketType &&
      (knownTicketType.ticket_group === KnownTicketGroup.Zuconnect23 ||
        knownTicketType.ticket_group === KnownTicketGroup.Zuzalu23) &&
      isEqualEdDSAPublicKey(
        JSON.parse(knownTicketType.public_key),
        pcd.proof.eddsaPCD.claim.publicKey
      )
    ) {
      // We can say that the submitted ticket can be verified as belonging
      // to a known group
      return {
        success: true,
        value: {
          verified: true,
          publicKeyName: knownTicketType.known_public_key_name,
          group: knownTicketType.ticket_group
        }
      };
    } else {
      return {
        success: true,
        value: {
          verified: false,
          message: "Not a valid ticket"
        }
      };
    }
  }

  public async handleVerifyTicketRequest(
    req: VerifyTicketRequest
  ): Promise<VerifyTicketResult> {
    const pcdStr = req.pcd;

    try {
      return this.verifyZuconnect23OrZuzalu23Ticket(JSON.parse(pcdStr));
    } catch (e) {
      throw new PCDHTTPError(500, "The ticket could not be verified", {
        cause: e
      });
    }
  }

  /**
   * Returns information about the known public keys, and known ticket types.
   * This is used by clients to perform basic checks of validity against
   * ticket PCDs, based on the public key and ticket/event IDs.
   */
  public async handleKnownTicketTypesRequest(): Promise<KnownTicketTypesResult> {
    const knownTickets = await fetchKnownTicketTypes(this.context.dbPool);
    const knownPublicKeys = await fetchKnownPublicKeys(this.context.dbPool);
    return {
      success: true,
      value: {
        publicKeys: knownPublicKeys.map((pk) => {
          return {
            publicKey:
              pk.public_key_type === "eddsa"
                ? JSON.parse(pk.public_key)
                : pk.public_key,
            publicKeyName: pk.public_key_name,
            publicKeyType: pk.public_key_type
          };
        }),
        knownTicketTypes: knownTickets.map((tt) => {
          return {
            eventId: tt.event_id,
            productId: tt.product_id,
            publicKey:
              tt.known_public_key_type === "eddsa"
                ? JSON.parse(tt.public_key)
                : tt.public_key,
            publicKeyName: tt.known_public_key_name,
            publicKeyType: tt.known_public_key_type,
            ticketGroup: tt.ticket_group
          };
        })
      }
    };
  }
}

export async function startIssuanceService(
  context: ApplicationContext,
  cacheService: PersistentCacheService,
  rollbarService: RollbarService | null,
  multiprocessService: MultiProcessService
): Promise<IssuanceService | null> {
  const zupassRsaKey = loadRSAPrivateKey();
  const zupassEddsaKey = loadEdDSAPrivateKey();

  if (zupassRsaKey == null || zupassEddsaKey == null) {
    logger("[INIT] can't start issuance service, missing private key");
    return null;
  }

  await setupKnownTicketTypes(
    context.dbPool,
    await getEdDSAPublicKey(zupassEddsaKey)
  );

  const issuanceService = new IssuanceService(
    context,
    cacheService,
    multiprocessService,
    rollbarService,
    zupassRsaKey,
    zupassEddsaKey
  );

  return issuanceService;
}

/**
 * The issuance service relies on a list of known ticket types, and their
 * associated public keys. This relies on having these stored in the database,
 * and we can ensure that certain known public keys and tickets are stored by
 * inserting them here.
 *
 * This works because we know the key we're using to issue tickets, and we
 * have some hard-coded IDs for Zuzalu '23 tickets.
 *
 * See {@link verifyTicket} and {@link handleKnownTicketTypesRequest} for
 * usage of this data.
 *
 * See also {@link setDevconnectTicketTypes} in the Devconnect sync service.
 */
async function setupKnownTicketTypes(
  db: Pool,
  eddsaPubKey: EdDSAPublicKey
): Promise<void> {
  await setKnownPublicKey(
    db,
    ZUPASS_TICKET_PUBLIC_KEY_NAME,
    KnownPublicKeyType.EdDSA,
    JSON.stringify(eddsaPubKey)
  );

  await setKnownTicketType(
    db,
    "ZUZALU23_VISITOR",
    ZUZALU_23_EVENT_ID,
    ZUZALU_23_VISITOR_PRODUCT_ID,
    ZUPASS_TICKET_PUBLIC_KEY_NAME,
    KnownPublicKeyType.EdDSA,
    KnownTicketGroup.Zuzalu23
  );

  await setKnownTicketType(
    db,
    "ZUZALU23_RESIDENT",
    ZUZALU_23_EVENT_ID,
    ZUZALU_23_RESIDENT_PRODUCT_ID,
    ZUPASS_TICKET_PUBLIC_KEY_NAME,
    KnownPublicKeyType.EdDSA,
    KnownTicketGroup.Zuzalu23
  );

  await setKnownTicketType(
    db,
    "ZUZALU23_ORGANIZER",
    ZUZALU_23_EVENT_ID,
    ZUZALU_23_ORGANIZER_PRODUCT_ID,
    ZUPASS_TICKET_PUBLIC_KEY_NAME,
    KnownPublicKeyType.EdDSA,
    KnownTicketGroup.Zuzalu23
  );

  // Store Zuconnect ticket types
  for (const { id } of Object.values(ZUCONNECT_PRODUCT_ID_MAPPINGS)) {
    setKnownTicketType(
      db,
      `zuconnect-${id}`,
      ZUCONNECT_23_EVENT_ID,
      id,
      ZUPASS_TICKET_PUBLIC_KEY_NAME,
      KnownPublicKeyType.EdDSA,
      KnownTicketGroup.Zuconnect23
    );
  }
}

function loadRSAPrivateKey(): NodeRSA | null {
  const pkeyEnv = process.env.SERVER_RSA_PRIVATE_KEY_BASE64;

  if (pkeyEnv == null) {
    logger("[INIT] missing environment variable SERVER_RSA_PRIVATE_KEY_BASE64");
    return null;
  }

  try {
    const key = new NodeRSA(
      Buffer.from(pkeyEnv, "base64").toString("utf-8"),
      "private"
    );
    return key;
  } catch (e) {
    logger("failed to parse RSA private key", e);
  }

  return null;
}

function loadEdDSAPrivateKey(): string | null {
  const pkeyEnv = process.env.SERVER_EDDSA_PRIVATE_KEY;

  if (pkeyEnv == null) {
    logger("[INIT] missing environment variable SERVER_EDDSA_PRIVATE_KEY");
    return null;
  }

  return pkeyEnv;
}
