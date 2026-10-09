export type ActorCredit = {
  id: string;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  alternateTitles: string[];
  releaseDate: string;
  year: number | null;
  department: string;
  job: string;
  character: string;
  rating: number | null;
  posterUrl: string | null;
  genres: string[];
};

export type ActorProfile = {
  id: string;
  name: string;
  originalName: string;
  alternateNames: string[];
  biography: string;
  birthday: string | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  knownForDepartment: string | null;
  imdbId: string | null;
  instagramId: string | null;
  filmography: ActorCredit[];
};

export type SimilarActor = {
  id: string;
  name: string;
  profileUrl: string | null;
  sharedCredits: number;
};

export type ActorAward = {
  title: string;
  year: number;
  category: string;
  work: string;
  result: "winner" | "nominee";
};