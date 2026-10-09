import "server-only";

import { authorizePublicActorRead } from "./policy";
import { ActorAward } from "./types";

type MockActorAwards = { source: "sample"; awards: ActorAward[] };

const sampleAwards: Record<string, ActorAward[]> = {
  "1190668": [
    { title: "Academy Awards", year: 2018, category: "Actor in a Leading Role", work: "Call Me by Your Name", result: "nominee" },
    { title: "Golden Globe Awards", year: 2018, category: "Best Actor - Drama", work: "Call Me by Your Name", result: "nominee" },
    { title: "BAFTA Awards", year: 2018, category: "Leading Actor", work: "Call Me by Your Name", result: "nominee" },
  ],
  "505710": [
    { title: "Primetime Emmy Awards", year: 2020, category: "Outstanding Lead Actress in a Drama Series", work: "Euphoria", result: "winner" },
    { title: "Primetime Emmy Awards", year: 2022, category: "Outstanding Lead Actress in a Drama Series", work: "Euphoria", result: "winner" },
  ],
};

export interface ActorAwardsRepository {
  getAwards(actorId: string): Promise<MockActorAwards>;
}

export class MockActorAwardsRepository implements ActorAwardsRepository {
  async getAwards(actorId: string): Promise<MockActorAwards> {
    const { actorId: authorizedId } = authorizePublicActorRead(actorId);
    return { source: "sample", awards: sampleAwards[authorizedId] ?? [] };
  }
}

export const actorAwardsRepository: ActorAwardsRepository = new MockActorAwardsRepository();