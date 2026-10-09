// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import FilmographyExplorer from "./FilmographyExplorer";
import { ActorCredit } from "../../lib/actors/types";

const credits: ActorCredit[] = [
  {
    id: "1", mediaType: "movie", title: "Dune", originalTitle: "Dune", alternateTitles: [], releaseDate: "2021-10-22",
    year: 2021, department: "Acting", job: "", character: "Paul", rating: 8, posterUrl: null, genres: ["Science Fiction"],
  },
  {
    id: "2", mediaType: "movie", title: "Quiet City", originalTitle: "Quiet City", alternateTitles: [], releaseDate: "2020-05-12",
    year: 2020, department: "Acting", job: "", character: "Lead", rating: 7, posterUrl: null, genres: ["Drama"],
  },
  {
    id: "3", mediaType: "tv", title: "City Stories", originalTitle: "City Stories", alternateTitles: [], releaseDate: "2020-02-01",
    year: 2020, department: "Acting", job: "", character: "Detective", rating: 7.5, posterUrl: null, genres: ["Drama"],
  },
];

describe("FilmographyExplorer filters", () => {
  it("combines year, genre, role, and title filters and announces empty results", () => {
    render(createElement(FilmographyExplorer, { credits, locale: "en-US" }));
    expect(screen.getByText("Showing 3 of 3 filmography credits.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2020" } });
    expect(screen.getByText("Showing 2 of 3 filmography credits.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "Drama" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Detective" } });
    expect(screen.getByText("Showing 1 of 3 filmography credits.")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "missing title" } });
    expect(screen.getByText("Showing 0 of 3 filmography credits.")).toBeTruthy();
    expect(screen.getByText("No credits match these filters.")).toBeTruthy();
  });
});